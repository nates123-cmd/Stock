import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Text,
  Heading,
  Numeric,
  SectionLabel,
  Glyph,
  Card,
  Button,
  Pill,
  SourceBadge,
  BottomActionBar,
  ProgressStepList,
  FilterChip,
  type ProgressStep,
} from '@/components';
import { colors, layout } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { usePipelineStore } from '@/store/pipeline';
import * as DocumentPicker from 'expo-document-picker';
import {
  parseRecipeFromText,
  parseRecipeFromUrl,
  parseRecipeFromPdf,
  parseRecipeFromImage,
  inferRecipeFromTranscript,
  matchPipelineKeywords,
  detectSource,
  type ParsedRecipeDraft,
} from '@/lib/parsing';
import { CLAUDE_AVAILABLE, type ImageMediaType } from '@/lib/api/claudeBridge';
import { formatAmount } from '@/lib/format';
import { CUISINES, cuisineLabel, deriveCuisine, normCuisine } from '@/lib/cuisine';
import { parseQty } from '@/lib/qty';
import { uid } from '@/lib/id';
import type { Ingredient, PipelineIdea, Recipe, RecipeSource, Step as RecipeStep } from '@/types';

type Step = 'capture' | 'parsing' | 'review' | 'saved';

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

/** Pasted YouTube "Show transcript" text — many lines that are a bare
 *  timestamp or start with one (e.g. "0:42" / "12:05 add the butter"). Routes
 *  to the transcript-tuned inference instead of the literal text parser. */
const looksLikeTranscript = (s: string): boolean => {
  const lines = s.split(/\r?\n/);
  const stamped = lines.filter((l) =>
    /^\s*\d{1,2}:\d{2}(?::\d{2})?(\s|$)/.test(l),
  ).length;
  return stamped >= 5;
};

const MAX_PDF_BYTES = 12 * 1024 * 1024; // recipes are tiny; Anthropic cap is 32MB
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // ~6 MB binary; comfortably under proxy 8MB-base64 cap

const ALLOWED_IMAGE_TYPES: ReadonlySet<ImageMediaType> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function inferImageType(mime: string | undefined, uri: string): ImageMediaType {
  const fromMime = (mime ?? '').toLowerCase();
  if (ALLOWED_IMAGE_TYPES.has(fromMime as ImageMediaType)) return fromMime as ImageMediaType;
  // Some pickers don't surface a mime — fall back to extension. iOS HEIC
  // photos get converted to JPEG by the picker, so we don't handle them here.
  const ext = (uri.toLowerCase().split('?')[0] ?? '').split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

/** Read a picked file (native file:// or web blob:) into base64, no prefix. */
async function fileToBase64(uri: string, maxBytes: number, kind: 'PDF' | 'image'): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  if (blob.size > maxBytes) {
    throw new Error(
      kind === 'PDF'
        ? 'That PDF is large — try a single-recipe print/export.'
        : 'That image is too large — try a smaller screenshot or photo.',
    );
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onloadend = () => {
      const s = String(reader.result);
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.readAsDataURL(blob);
  });
}

function sourceLabel(src: RecipeSource): string {
  if (src.type === 'nyt') return 'NYT Cooking';
  if (src.type === 'yt') return 'YouTube';
  if (src.url) return 'Web page';
  return 'Pasted text';
}

/** Source/origin options offered in the review step so the captured source can
 *  be corrected before saving (patch #77641107). */
const SOURCE_TYPES: { key: RecipeSource['type']; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'nyt', label: 'NYT' },
  { key: 'yt', label: 'YouTube' },
  { key: 'book', label: 'Book' },
  { key: 'web', label: 'Web' },
];

export default function CaptureFlow() {
  const router = useRouter();
  const save = useRecipeStore((s) => s.save);
  const promote = usePipelineStore((s) => s.promote);
  const ideas = usePipelineStore((s) => s.ideas);
  const hydratePipeline = usePipelineStore((s) => s.hydrate);

  // Promotion context (spec §8 "Idea → Recipe"): title pre-filled, idea
  // references carried over, idea archived once the recipe is saved.
  const params = useLocalSearchParams<{
    ideaId?: string;
    prefillTitle?: string;
    refs?: string;
    /** Bench Convert "Save as recipe" seeds the paste area (spec §9). */
    prefillText?: string;
    /** Set by plan-picker so "Done" after save returns to the plan flow. */
    planDate?: string;
    planType?: string;
  }>();
  const planReturn = params.planDate ? { date: params.planDate, type: params.planType } : null;
  const ideaRefs = useMemo<{ url: string; label: string }[]>(() => {
    try {
      return params.refs ? JSON.parse(params.refs) : [];
    } catch {
      return [];
    }
  }, [params.refs]);

  const [step, setStep] = useState<Step>('capture');
  const [raw, setRaw] = useState(params.prefillText ?? '');
  const [draft, setDraft] = useState<ParsedRecipeDraft | null>(null);
  /** Bumped once per completed parse. See the setDraft sites above. */
  const [parseId, setParseId] = useState(0);
  const [progress, setProgress] = useState<ProgressStep[]>([]);
  const [error, setError] = useState<string | null>(null);

  // review edits
  const [title, setTitle] = useState(params.prefillTitle ?? '');
  const [serves, setServes] = useState('4');
  const [intention, setIntention] = useState('');
  // Flag it "to try" at capture time (you've saved it but haven't cooked it).
  const [toTry, setToTry] = useState(false);
  // Editable source/origin — seeded from the parsed/detected source when a
  // draft lands in review, then user-correctable (patch #77641107).
  const [source, setSource] = useState<RecipeSource | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  /** Set when a save was refused because this recipe is already in the library. */
  const [duplicateOf, setDuplicateOf] = useState<Recipe | null>(null);
  const inputRef = useRef<TextInput>(null);

  // §11.10 — Pipeline ideas this capture might be fulfilling. `linkedIdeaId`
  // is the one the user chose to link (promoted on save). Skipped when the
  // capture was itself launched FROM an idea (params.ideaId already links it).
  const [relatedIdeaIds, setRelatedIdeaIds] = useState<string[]>([]);
  const [linkedIdeaId, setLinkedIdeaId] = useState<string | null>(null);
  const matchedForParse = useRef<number>(-1);

  useEffect(() => {
    void hydratePipeline();
  }, [hydratePipeline]);

  // When a draft lands in review, ask Claude which open ideas it matches.
  useEffect(() => {
    if (step !== 'review' || !draft || params.ideaId) return;
    if (matchedForParse.current === parseId) return; // once per parse
    matchedForParse.current = parseId;
    const open = ideas.filter((i) => i.status !== 'promoted');
    if (open.length === 0) return;
    const recipeText = [
      draft.title ?? '',
      ...(draft.ingredients ?? []).map((i) => i.canonicalName),
      ...(draft.steps ?? []).map((s) => s.title),
    ].join('\n');
    let cancelled = false;
    void matchPipelineKeywords(
      recipeText,
      open.map((i) => ({ id: i.id, title: i.title })),
    ).then((ids) => {
      if (!cancelled) setRelatedIdeaIds(ids);
    });
    return () => {
      cancelled = true;
    };
    // `draft` is deliberately NOT a dependency: it changes on every edit in the
    // review step, and this fires a network call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, parseId, ideas, params.ideaId]);

  const relatedIdeas = useMemo(
    () => ideas.filter((i) => relatedIdeaIds.includes(i.id)),
    [ideas, relatedIdeaIds],
  );

  const src: RecipeSource = isUrl(raw)
    ? detectSource(raw.trim())
    : looksLikeTranscript(raw)
      ? { type: 'yt', name: 'YouTube' }
      : { type: 'mine' };
  const hasContent = raw.trim().length > 0;

  // Seed the editable source each time a fresh PARSE arrives. Keyed on
  // parseId, not on `draft`: the review step edits the draft in place now, so
  // draft identity changes constantly and this would stamp the parsed source
  // back over a correction the moment anything else was touched.
  useEffect(() => {
    if (!draft) return;
    setSource(draft.source ?? src);
    // Auto-assign the cuisine so the preview shows it and it can be corrected
    // BEFORE saving — same "guess, then let the user overrule" pattern as the
    // tags. The store re-derives on save anyway, so this is about visibility,
    // not correctness. Skipped when the parser already supplied one.
    if (!draft.cuisine) {
      const guess = deriveCuisine({
        title: draft.title,
        ingredients: draft.ingredients ?? [],
        steps: draft.steps ?? [],
        tags: draft.tags ?? [],
      });
      if (guess) setDraft((d) => (d ? { ...d, cuisine: guess, cuisineAuto: true } : d));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parseId]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/recipes'));

  const runParse = useCallback(async () => {
    setStep('parsing');
    setError(null);
    const transcript = !isUrl(raw) && looksLikeTranscript(raw);
    const seq: ProgressStep[] = [
      {
        label: isUrl(raw)
          ? 'Fetched the page'
          : transcript
            ? 'Read the transcript'
            : 'Read the text',
        state: 'doing',
      },
      {
        label: transcript ? 'Inferring the recipe (best-guess)' : 'Structuring ingredients & method',
        state: 'todo',
      },
      { label: 'Checking against your pantry', state: 'todo' },
      { label: 'Suggesting tags', state: 'todo' },
    ];
    setProgress(seq);
    const tick = (i: number, state: ProgressStep['state']) =>
      setProgress((p) => p.map((s, idx) => (idx === i ? { ...s, state } : s)));
    try {
      tick(0, 'done');
      tick(1, 'doing');
      const d = isUrl(raw)
        ? await parseRecipeFromUrl(raw.trim())
        : transcript
          ? await inferRecipeFromTranscript(raw)
          : await parseRecipeFromText(raw, { type: 'mine' });
      tick(1, 'done');
      tick(2, 'done'); // pantry pillar not built yet (spec §10) — no-op pass
      tick(3, 'done');
      setDraft(d);
      setTitle(d.title ?? '');
      setServes(String(d.yield?.serves ?? 4));
      // A FRESH parse, as distinct from an edit to the draft that's already on
      // screen. The review step is editable now, so `draft` gets a new identity
      // on every keystroke — the once-per-parse effects below key off this
      // counter instead, or they'd re-seed the source and re-run the pipeline
      // match on every character typed.
      setParseId((n) => n + 1);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parsing failed.');
    }
  }, [raw]);

  const runPdfImport = useCallback(async () => {
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch {
      return; // picker unavailable / dismissed by the OS
    }
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];

    setStep('parsing');
    setError(null);
    const seq: ProgressStep[] = [
      { label: 'Read the PDF', state: 'doing' },
      { label: 'Structuring ingredients & method', state: 'todo' },
      { label: 'Checking against your pantry', state: 'todo' },
      { label: 'Suggesting tags', state: 'todo' },
    ];
    setProgress(seq);
    const tick = (i: number, state: ProgressStep['state']) =>
      setProgress((p) => p.map((s, idx) => (idx === i ? { ...s, state } : s)));
    try {
      const b64 = await fileToBase64(asset.uri, MAX_PDF_BYTES, 'PDF');
      tick(0, 'done');
      tick(1, 'doing');
      const d = await parseRecipeFromPdf(b64);
      tick(1, 'done');
      tick(2, 'done');
      tick(3, 'done');
      setDraft(d);
      setTitle(d.title ?? '');
      setServes(String(d.yield?.serves ?? 4));
      // A FRESH parse, as distinct from an edit to the draft that's already on
      // screen. The review step is editable now, so `draft` gets a new identity
      // on every keystroke — the once-per-parse effects below key off this
      // counter instead, or they'd re-seed the source and re-run the pipeline
      // match on every character typed.
      setParseId((n) => n + 1);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that PDF.');
    }
  }, []);

  const runPhotoImport = useCallback(async () => {
    // DocumentPicker with image/* cross-platform: on iOS Safari the file
    // input shows "Take Photo / Photo Library / Choose Files" — that's the
    // camera path for the PWA. On native it shows Files; users with photo-
    // roll access install expo-image-picker as a v1.1 upgrade.
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch {
      return;
    }
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];

    setStep('parsing');
    setError(null);
    const seq: ProgressStep[] = [
      { label: 'Read the photo', state: 'doing' },
      { label: 'Reading the recipe (OCR)', state: 'todo' },
      { label: 'Checking against your pantry', state: 'todo' },
      { label: 'Suggesting tags', state: 'todo' },
    ];
    setProgress(seq);
    const tick = (i: number, state: ProgressStep['state']) =>
      setProgress((p) => p.map((s, idx) => (idx === i ? { ...s, state } : s)));
    try {
      const b64 = await fileToBase64(asset.uri, MAX_IMAGE_BYTES, 'image');
      const mediaType = inferImageType(asset.mimeType, asset.uri);
      tick(0, 'done');
      tick(1, 'doing');
      const d = await parseRecipeFromImage(b64, mediaType);
      tick(1, 'done');
      tick(2, 'done');
      tick(3, 'done');
      setDraft(d);
      setTitle(d.title ?? '');
      setServes(String(d.yield?.serves ?? 4));
      // A FRESH parse, as distinct from an edit to the draft that's already on
      // screen. The review step is editable now, so `draft` gets a new identity
      // on every keystroke — the once-per-parse effects below key off this
      // counter instead, or they'd re-seed the source and re-run the pipeline
      // match on every character typed.
      setParseId((n) => n + 1);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that image.');
    }
  }, []);

  const persist = async (status: Recipe['status'], force = false) => {
    if (!draft) return;
    const now = new Date();
    const refsNote = ideaRefs.length
      ? `Notes & references\n${ideaRefs
          .map((r) => `• ${r.label} — ${r.url}`)
          .join('\n')}`
      : undefined;
    const recipe: Recipe = {
      id: uid('rec'),
      title: title.trim() || 'Untitled recipe',
      source: source ?? draft.source ?? src,
      status,
      yield: { serves: Math.max(1, parseInt(serves, 10) || 4), totalMinutes: draft.yield?.totalMinutes },
      ingredients: draft.ingredients ?? [],
      steps: draft.steps ?? [],
      tags: draft.tags ?? [],
      // Cuisine as reviewed: either the deriver's guess, or whatever was picked
      // in the review step (which clears `cuisineAuto`, making it permanent).
      ...(draft.cuisine ? { cuisine: draft.cuisine } : {}),
      ...(draft.cuisine && draft.cuisineAuto ? { cuisineAuto: true as const } : {}),
      // Carry the parser's extracted photo + per-serving nutrition through to
      // the saved recipe — they were being silently dropped here.
      imageUrl: draft.imageUrl,
      nutrition: draft.nutrition,
      myNotes: refsNote,
      firstCookIntention: intention.trim() || undefined,
      isToTry: toTry || undefined,
      linkedPipelineId: params.ideaId || linkedIdeaId || undefined,
      createdAt: now,
      modifiedAt: now,
      cookCount: 0,
    };
    // `force` is the second press, after the duplicate notice has told the
    // user what they're about to double.
    const res = await save(recipe, { allowDuplicate: force });
    if (!res.ok) {
      // Not an error — the recipe is already here. Show which one, and let
      // them open it or save this copy anyway.
      setDuplicateOf(res.duplicateOf);
      return;
    }
    setDuplicateOf(null);
    // Promote whichever idea this fulfills: the one we were launched from, or
    // the one the user linked from the §11.10 related-ideas suggestions.
    const fulfilled = params.ideaId || linkedIdeaId;
    if (fulfilled) await promote(fulfilled, recipe.id);
    setSavedId(recipe.id);
    setStep('saved');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {step === 'capture' && (
          <CaptureStep
            raw={raw}
            setRaw={setRaw}
            inputRef={inputRef}
            hasContent={hasContent}
            src={src}
            onCancel={close}
            onNext={runParse}
            onPickPdf={runPdfImport}
            onPickPhoto={runPhotoImport}
          />
        )}
        {step === 'parsing' && (
          <ParsingStep
            src={draft?.source ?? src}
            progress={progress}
            error={error}
            onRetry={() => setStep('capture')}
          />
        )}
        {step === 'review' && draft && (
          <ReviewStep
            draft={draft}
            onPatch={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
            title={title}
            setTitle={setTitle}
            serves={serves}
            setServes={setServes}
            intention={intention}
            setIntention={setIntention}
            toTry={toTry}
            setToTry={setToTry}
            source={source ?? draft.source ?? src}
            setSource={setSource}
            relatedIdeas={relatedIdeas}
            linkedIdeaId={linkedIdeaId}
            onToggleLink={(id) => setLinkedIdeaId((cur) => (cur === id ? null : id))}
            onSaveDraft={() => persist('draft')}
            onSave={() => persist('active')}
            duplicateOf={duplicateOf}
            onOpenDuplicate={() => {
              if (!duplicateOf) return;
              router.push({ pathname: '/recipes/[id]', params: { id: duplicateOf.id } });
            }}
            onSaveAnyway={() => persist('active', true)}
          />
        )}
        {step === 'saved' && draft && (
          <SavedStep
            title={title}
            source={source ?? draft.source ?? src}
            count={draft.ingredients?.length ?? 0}
            onView={() => {
              close();
              if (savedId)
                router.push({ pathname: '/recipes/[id]', params: { id: savedId } });
            }}
            onAnother={() => {
              setRaw('');
              setDraft(null);
              setSource(null);
              setSavedId(null);
              setStep('capture');
            }}
            doneLabel={planReturn ? 'Back to plan' : 'Done'}
            onDone={() => {
              if (planReturn) {
                router.replace({
                  pathname: '/plan-picker',
                  params: {
                    date: planReturn.date,
                    ...(planReturn.type ? { type: planReturn.type } : {}),
                  },
                });
              } else {
                close();
              }
            }}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------- Step 1 + 2: capture / detected ---------- */
function CaptureStep({
  raw,
  setRaw,
  inputRef,
  hasContent,
  src,
  onCancel,
  onNext,
  onPickPdf,
  onPickPhoto,
}: {
  raw: string;
  setRaw: (s: string) => void;
  inputRef: React.RefObject<TextInput | null>;
  hasContent: boolean;
  src: RecipeSource;
  onCancel: () => void;
  onNext: () => void;
  onPickPdf: () => void;
  onPickPhoto: () => void;
}) {
  const recipes = useRecipeStore((s) => s.recipes);
  const [tip, setTip] = useState<string | null>(null);
  return (
    <>
      <View style={styles.modalHeader}>
        <Heading variant="screenTitle">Capture a recipe</Heading>
        <Pressable onPress={onCancel} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Cancel
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => inputRef.current?.focus()}>
          <View style={[styles.paste, hasContent && styles.pasteActive]}>
            {hasContent ? (
              <View style={styles.detectedRow}>
                <Glyph name="pageRight" size={14} color="accent" />
                <Text variant="sectionLabel" color="accent">
                  {sourceLabel(src)} · detected
                </Text>
              </View>
            ) : null}
            <TextInput
              ref={inputRef}
              value={raw}
              onChangeText={setRaw}
              multiline
              placeholder="Paste a URL, recipe text, or a video transcript — or just start typing"
              placeholderTextColor={colors.textFaint}
              style={styles.pasteInput}
            />
          </View>
        </Pressable>

        <View style={styles.modeRow}>
          <Button label="Type" variant="secondary" flex onPress={() => inputRef.current?.focus()} />
          <Button label="PDF" variant="secondary" flex onPress={onPickPdf} />
          <Button label="Photo" variant="secondary" flex onPress={onPickPhoto} />
        </View>
        {tip ? (
          <Text color="textMuted" style={styles.tip}>
            {tip}
          </Text>
        ) : null}

        {!CLAUDE_AVAILABLE ? (
          <Text color="textFaint" style={styles.tip}>
            Claude isn't configured — using the built-in parser. Set the
            Claude proxy (web) or EXPO_PUBLIC_ANTHROPIC_API_KEY (native) for
            higher-fidelity parsing (spec §11/§14.2).
          </Text>
        ) : null}

        {recipes.length > 0 ? (
          <View style={styles.recent}>
            <SectionLabel color="textMuted">Recent sources</SectionLabel>
            {recipes.slice(0, 4).map((r) => (
              <View key={r.id} style={styles.recentRow}>
                <SourceBadge source={r.source} />
                <Text color="textMuted" numberOfLines={1} style={styles.flex}>
                  {r.title}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <BottomActionBar>
        <Button label="Cancel" variant="secondary" flex onPress={onCancel} />
        <Button label="Next" glyph="next" flex disabled={!hasContent} onPress={onNext} />
      </BottomActionBar>
    </>
  );
}

/* ---------- Step 3: parsing ---------- */
function ParsingStep({
  src,
  progress,
  error,
  onRetry,
}: {
  src: RecipeSource;
  progress: ProgressStep[];
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <View style={styles.bodyCentered}>
      <Heading variant="screenTitle" style={styles.parseTitle}>
        {error ? 'Could not parse' : 'Reading your recipe'}
      </Heading>

      <Card style={styles.sourceCard}>
        <SourceBadge source={src} />
        <Text color="textMuted">{sourceLabel(src)}</Text>
      </Card>

      {error ? (
        <>
          <Text color="warn" style={styles.parseNote}>
            {error}
          </Text>
          <Button label="Back" variant="secondary" onPress={onRetry} />
        </>
      ) : (
        <>
          <ProgressStepList steps={progress} />
          <Text color="textFaint" style={styles.parseNote}>
            {src.type === 'nyt'
              ? 'NYT pages are clean — this should be accurate.'
              : 'Pasted/loose sources are best-guess. Review everything next.'}
          </Text>
        </>
      )}
    </View>
  );
}

/* ---------- Step 4: review ---------- */
function ReviewStep({
  draft,
  onPatch,
  title,
  setTitle,
  serves,
  setServes,
  intention,
  setIntention,
  toTry,
  setToTry,
  source,
  setSource,
  relatedIdeas,
  linkedIdeaId,
  onToggleLink,
  onSaveDraft,
  onSave,
  duplicateOf,
  onOpenDuplicate,
  onSaveAnyway,
}: {
  draft: ParsedRecipeDraft;
  /** Edit the parsed draft in place, before it is ever saved. */
  onPatch: (patch: Partial<ParsedRecipeDraft>) => void;
  title: string;
  setTitle: (s: string) => void;
  serves: string;
  setServes: (s: string) => void;
  intention: string;
  setIntention: (s: string) => void;
  toTry: boolean;
  setToTry: (b: boolean) => void;
  source: RecipeSource;
  setSource: (s: RecipeSource) => void;
  relatedIdeas: PipelineIdea[];
  linkedIdeaId: string | null;
  onToggleLink: (id: string) => void;
  onSaveDraft: () => void;
  onSave: () => void;
  /** The library copy that blocked this save, if one did. */
  duplicateOf: Recipe | null;
  onOpenDuplicate: () => void;
  onSaveAnyway: () => void;
}) {
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [units, setUnits] = useState<'original' | 'grams'>('original');
  const [tagDraft, setTagDraft] = useState('');
  const [pickCuisine, setPickCuisine] = useState(false);
  const conf = draft.fieldConfidence ?? {};
  const guessed = (k: string) => conf[k] === 'guessed';
  const ingredients = draft.ingredients ?? [];
  const steps = draft.steps ?? [];
  const tags = draft.tags ?? [];
  // Editing is the whole point of this screen now, so the method list opens
  // fully as soon as you touch it — a collapsed step you can't see is one you
  // can't fix. The +N more control still gates the FIRST view.
  const shownSteps = showAllSteps ? steps : steps.slice(0, 3);
  const cuisine = draft.cuisine ? normCuisine(draft.cuisine) : undefined;

  /* ---- draft editing ---- */

  const patchIngredient = (id: string, patch: Partial<Ingredient>) =>
    onPatch({
      ingredients: ingredients.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    });

  /** The qty column is ONE free-text field ("200 g", "1 1/2 cups"). Splitting
   *  it into number + unit inputs is more taps for every row and gets in the
   *  way of the messy cases a bad parse actually produces. */
  const setIngredientQty = (id: string, raw: string) => {
    const { amount, unit } = parseQty(raw);
    patchIngredient(id, {
      amount,
      // Keep the raw text as the unit when it won't parse, so nothing typed is
      // silently dropped (same rule the plan wizard uses for mixed units).
      unit: amount != null ? unit : raw.trim() || null,
    });
  };

  const removeIngredient = (id: string) =>
    onPatch({ ingredients: ingredients.filter((i) => i.id !== id) });

  const addIngredient = () =>
    onPatch({
      ingredients: [
        ...ingredients,
        {
          id: uid('ing'),
          amount: null,
          unit: null,
          canonicalName: '',
          modificationHistory: [],
        },
      ],
    });

  const patchStep = (id: string, body: string) =>
    onPatch({ steps: steps.map((st) => (st.id === id ? { ...st, body } : st)) });

  /** Renumber after any removal — `ordinal` is what the cook screen counts by,
   *  so a gap turns into "Step 4" following "Step 2". */
  const renumber = (list: RecipeStep[]): RecipeStep[] =>
    list.map((st, i) => ({ ...st, ordinal: i + 1 }));

  const removeStep = (id: string) =>
    onPatch({ steps: renumber(steps.filter((st) => st.id !== id)) });

  const addStep = () =>
    onPatch({
      steps: renumber([
        ...steps,
        { id: uid('step'), ordinal: steps.length + 1, body: '' } as RecipeStep,
      ]),
    });

  const removeTag = (t: string) => onPatch({ tags: tags.filter((x) => x !== t) });

  const commitTag = () => {
    const t = tagDraft.trim().toLowerCase();
    setTagDraft('');
    if (!t || tags.some((x) => x.toLowerCase() === t)) return;
    onPatch({ tags: [...tags, t] });
  };

  return (
    <>
      <View style={styles.modalHeader}>
        <Heading variant="screenTitle">Review</Heading>
        <Pressable onPress={() => setUnits((u) => (u === 'original' ? 'grams' : 'original'))} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            {units === 'original' ? 'Original units' : 'Grams'}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Field label="Title" confidence={guessed('title')}>
          <TextInput value={title} onChangeText={setTitle} style={styles.field} />
        </Field>

        <Field label="Serves" confidence={guessed('yield')}>
          <TextInput
            value={serves}
            onChangeText={setServes}
            keyboardType="number-pad"
            style={styles.field}
          />
        </Field>

        <View style={styles.reviewSection}>
          <View style={styles.labelRow}>
            <SectionLabel color="textMuted">Source</SectionLabel>
            <SourceBadge source={source} />
          </View>
          <View style={styles.tagRow}>
            {SOURCE_TYPES.map((st) => (
              <FilterChip
                key={st.key}
                label={st.label}
                active={source.type === st.key}
                onPress={() => setSource({ ...source, type: st.key })}
              />
            ))}
          </View>
          <TextInput
            value={source.name ?? ''}
            onChangeText={(t) => setSource({ ...source, name: t.length ? t : undefined })}
            placeholder="Name — e.g. NYT Cooking, Bon Appétit, Grandma"
            placeholderTextColor={colors.textFaint}
            style={styles.field}
          />
          <TextInput
            value={source.url ?? ''}
            onChangeText={(t) => setSource({ ...source, url: t.length ? t : undefined })}
            placeholder="https://… (optional)"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.field}
          />
        </View>

        {relatedIdeas.length > 0 ? (
          <View style={styles.reviewSection}>
            <SectionLabel color="textMuted">From your pipeline</SectionLabel>
            <Text color="textFaint" style={styles.tip}>
              This looks like one of your ideas. Link it to mark the idea cooked.
            </Text>
            <View style={styles.tagRow}>
              {relatedIdeas.map((idea) => (
                <FilterChip
                  key={idea.id}
                  label={idea.title}
                  active={linkedIdeaId === idea.id}
                  onPress={() => onToggleLink(idea.id)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.reviewSection}>
          <View style={styles.labelRow}>
            <SectionLabel color="textMuted">
              Ingredients · {draft.ingredients?.length ?? 0}
            </SectionLabel>
            {guessed('ingredients') ? <Pill label="guessed" tone="warn" /> : null}
          </View>
          {units === 'grams' ? (
            <Text color="textFaint" style={styles.tip}>
              Gram conversion runs through Bench (spec §9). Showing original units.
            </Text>
          ) : null}
          <View style={styles.ingList}>
            {ingredients.map((ing) => (
              <View key={ing.id} style={styles.ingEditRow}>
                <TextInput
                  defaultValue={formatAmount(ing.amount, ing.unit)}
                  onEndEditing={(e) => setIngredientQty(ing.id, e.nativeEvent.text)}
                  placeholder="qty"
                  placeholderTextColor={colors.textFaint}
                  style={[styles.field, styles.qtyField]}
                  accessibilityLabel={`Amount for ${ing.canonicalName || 'new ingredient'}`}
                />
                <TextInput
                  value={ing.canonicalName}
                  onChangeText={(t) => patchIngredient(ing.id, { canonicalName: t })}
                  placeholder="ingredient"
                  placeholderTextColor={colors.textFaint}
                  style={[styles.field, styles.flex]}
                  accessibilityLabel="Ingredient name"
                />
                <Pressable
                  onPress={() => removeIngredient(ing.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${ing.canonicalName || 'ingredient'}`}>
                  <Glyph name="close" size={16} color="textFaint" />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={addIngredient} accessibilityRole="button">
              <Text color="accent">+ Add ingredient</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.reviewSection}>
          <View style={styles.labelRow}>
            <SectionLabel color="textMuted">Method · {steps.length}</SectionLabel>
            {guessed('steps') ? <Pill label="guessed" tone="warn" /> : null}
          </View>
          <View style={styles.method}>
            {shownSteps.map((st) => (
              <View key={st.id} style={styles.stepEditRow}>
                <Text variant="recipeTitle" color="accent" style={styles.stepNum}>
                  {st.ordinal}
                </Text>
                <TextInput
                  value={st.body}
                  onChangeText={(t) => patchStep(st.id, t)}
                  multiline
                  placeholder="step"
                  placeholderTextColor={colors.textFaint}
                  style={[styles.field, styles.fieldMulti, styles.flex]}
                  accessibilityLabel={`Step ${st.ordinal}`}
                />
                <Pressable
                  onPress={() => removeStep(st.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove step ${st.ordinal}`}>
                  <Glyph name="close" size={16} color="textFaint" />
                </Pressable>
              </View>
            ))}
            {steps.length > 3 && !showAllSteps ? (
              <Pressable onPress={() => setShowAllSteps(true)}>
                <Text color="accent">{`+ ${steps.length - 3} more`}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={addStep} accessibilityRole="button">
              <Text color="accent">+ Add step</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.reviewSection}>
          <SectionLabel color="textMuted">Tags</SectionLabel>
          <View style={styles.tagRow}>
            {tags.map((t) => (
              <Pressable
                key={t}
                onPress={() => removeTag(t)}
                accessibilityRole="button"
                accessibilityLabel={`Remove tag ${t}`}>
                <Pill label={`${t}  ×`} tone="muted" />
              </Pressable>
            ))}
          </View>
          <TextInput
            value={tagDraft}
            onChangeText={setTagDraft}
            onSubmitEditing={commitTag}
            onEndEditing={commitTag}
            placeholder="add a tag"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            returnKeyType="done"
            style={styles.field}
          />
          <Text color="textFaint" style={styles.tip}>
            Auto tags (vegetarian, quick, weeknight…) are filled in on save and
            stay editable on the recipe.
          </Text>
        </View>

        <View style={styles.reviewSection}>
          <View style={styles.labelRow}>
            <SectionLabel color="textMuted">Cuisine</SectionLabel>
            {cuisine && draft.cuisineAuto ? <Pill label="guessed" tone="warn" /> : null}
          </View>
          {pickCuisine ? (
            <View style={styles.tagRow}>
              {CUISINES.map((c) => (
                <FilterChip
                  key={c}
                  label={cuisineLabel(c)}
                  active={cuisine === c}
                  onPress={() => {
                    // Choosing by hand clears `cuisineAuto`, which is what makes
                    // the choice stick against every later re-derivation.
                    if (cuisine === c) onPatch({ cuisine: undefined, cuisineAuto: undefined });
                    else onPatch({ cuisine: c, cuisineAuto: undefined });
                    setPickCuisine(false);
                  }}
                />
              ))}
            </View>
          ) : (
            <Pressable onPress={() => setPickCuisine(true)} accessibilityRole="button">
              <Text color={cuisine ? 'text' : 'textFaint'} variant={cuisine ? 'bodyStrong' : 'body'}>
                {cuisine ? cuisineLabel(cuisine) : 'Not set — tap to choose'}
              </Text>
            </Pressable>
          )}
        </View>

        {draft.nutrition ? (
          <View style={styles.reviewSection}>
            <View style={styles.labelRow}>
              <SectionLabel color="textMuted">Nutrition · per serving</SectionLabel>
              <Pill
                label={draft.nutrition.source === 'extracted' ? 'from source' : 'estimated'}
                tone={draft.nutrition.source === 'extracted' ? 'muted' : 'warn'}
              />
            </View>
            <Text color="textMuted">
              {[
                draft.nutrition.calories != null
                  ? `${Math.round(draft.nutrition.calories)} kcal`
                  : null,
                draft.nutrition.protein != null
                  ? `${Math.round(draft.nutrition.protein)}g protein`
                  : null,
                draft.nutrition.carbs != null
                  ? `${Math.round(draft.nutrition.carbs)}g carbs`
                  : null,
                draft.nutrition.fat != null
                  ? `${Math.round(draft.nutrition.fat)}g fat`
                  : null,
              ]
                .filter(Boolean)
                .join('  ·  ')}
            </Text>
          </View>
        ) : null}

        <View style={styles.reviewSection}>
          <SectionLabel color="textMuted">First cook intention</SectionLabel>
          <TextInput
            value={intention}
            onChangeText={setIntention}
            placeholder="optional — what are you trying with this one?"
            placeholderTextColor={colors.textFaint}
            multiline
            style={[styles.field, styles.fieldMulti]}
          />
        </View>

        <Pressable
          onPress={() => setToTry(!toTry)}
          style={styles.toTryToggle}
          accessibilityRole="button"
          accessibilityState={{ selected: toTry }}>
          <Glyph
            name={toTry ? 'toTry' : 'toTryOff'}
            size={20}
            color={toTry ? 'accent' : 'textFaint'}
          />
          <View style={styles.flex}>
            <Text variant="bodyStrong">Mark “to try”</Text>
            <Text color="textFaint">
              Haven’t cooked it yet — surfaces under the Recipes “To Try” tab.
            </Text>
          </View>
        </Pressable>
      </ScrollView>

      {duplicateOf && (
        <Card style={styles.dupeNotice}>
          <Text variant="bodyStrong">Already in your library</Text>
          <Text color="textMuted">
            “{duplicateOf.title}” looks like the same recipe. Saving again would
            give you two copies.
          </Text>
          <View style={styles.dupeActions}>
            <Button
              label="Open the one I have"
              variant="secondary"
              flex
              onPress={onOpenDuplicate}
            />
            <Button label="Save anyway" variant="secondary" flex onPress={onSaveAnyway} />
          </View>
        </Card>
      )}

      <BottomActionBar>
        <Button label="Save draft" variant="secondary" flex onPress={onSaveDraft} />
        <Button label="Save recipe" glyph="done" flex onPress={onSave} />
      </BottomActionBar>
    </>
  );
}

function Field({
  label,
  confidence,
  children,
}: {
  label: string;
  confidence?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.reviewSection}>
      <View style={styles.labelRow}>
        <SectionLabel color="textMuted">{label}</SectionLabel>
        {confidence ? (
          <Text color="warn" style={styles.confTag}>
            I guessed
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/* ---------- Step 5: saved ---------- */
function SavedStep({
  title,
  source,
  count,
  onView,
  onAnother,
  onDone,
  doneLabel = 'Done',
}: {
  title: string;
  source: RecipeSource;
  count: number;
  onView: () => void;
  onAnother: () => void;
  onDone: () => void;
  doneLabel?: string;
}) {
  return (
    <>
      <ScrollView contentContainerStyle={styles.bodyCentered}>
        <View style={styles.checkDisk}>
          <Glyph name="done" size={30} color="bg" />
        </View>
        <Heading variant="screenTitle">Saved.</Heading>

        <Card style={styles.savedCard}>
          <Text variant="recipeTitle">{title || 'Untitled recipe'}</Text>
          <View style={styles.savedMeta}>
            <SourceBadge source={source} />
            <Numeric color="textMuted">{count} ingredients</Numeric>
          </View>
        </Card>

        <View style={styles.nextList}>
          <SectionLabel color="textMuted">What's next</SectionLabel>
          <Pressable style={styles.nextRow} onPress={onView}>
            <Text color="accent">View the recipe</Text>
            <Glyph name="next" size={15} color="accent" />
          </Pressable>
          <View style={styles.nextRow}>
            <Text color="textFaint">Send to Bench — spec §9</Text>
          </View>
          <View style={styles.nextRow}>
            <Text color="textFaint">Add missing items to shopping — spec §5</Text>
          </View>
        </View>
      </ScrollView>

      <BottomActionBar>
        <Button label={doneLabel} variant="secondary" flex onPress={onDone} />
        <Button label="Add another" glyph="add" flex onPress={onAnother} />
      </BottomActionBar>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 14,
    paddingBottom: 12,
  },
  body: { paddingHorizontal: layout.screenPadding, paddingBottom: 28, gap: 16 },
  bodyCentered: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 40,
    alignItems: 'center',
    gap: 18,
  },
  paste: {
    minHeight: 150,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderStyle: 'dashed',
    borderRadius: layout.cardRadius,
    backgroundColor: colors.bg2,
    padding: 14,
    gap: 8,
  },
  pasteActive: { borderColor: colors.accent, borderStyle: 'solid' },
  detectedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pasteInput: {
    flex: 1,
    minHeight: 110,
    fontSize: 15,
    color: colors.text,
    textAlignVertical: 'top',
  },
  modeRow: { flexDirection: 'row', gap: 10 },
  tip: { fontStyle: 'italic', lineHeight: 19 },
  recent: { gap: 10, paddingTop: 6 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  parseTitle: { textAlign: 'center' },
  sourceCard: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12 },
  parseNote: { textAlign: 'center', fontStyle: 'italic', lineHeight: 20 },
  field: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  fieldMulti: { minHeight: 70, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 14 },
  reviewSection: { gap: 8 },
  toTryToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    marginTop: 4,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  confTag: { fontStyle: 'italic', fontSize: 12 },
  sourceInline: { paddingTop: 6 },
  ingList: { gap: 8 },
  ingRow: { flexDirection: 'row', gap: 12 },
  ingEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Wide enough for "1 1/2 cups" without wrapping, narrow enough that the
  // name field still gets most of a phone row.
  qtyField: { width: 96 },
  stepEditRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  amount: { minWidth: 60 },
  method: { gap: 14 },
  stepRow: { flexDirection: 'row', gap: 14 },
  stepNum: { minWidth: 20, textAlign: 'center' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  checkDisk: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.ok,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedCard: { width: '100%', gap: 10 },
  dupeNotice: { marginHorizontal: 16, marginBottom: 8, gap: 8 },
  dupeActions: { flexDirection: 'row', gap: 8 },
  savedMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nextList: { width: '100%', gap: 12, paddingTop: 6 },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
