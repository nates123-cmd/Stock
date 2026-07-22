/**
 * Email one-time-code sign-in. Signed in → cross-device sync turns on
 * (Phase 2). Signed out → app keeps working locally (existing IndexedDB path).
 *
 * Supabase emails an 8-digit code (no magic link / redirect); the user types
 * it back in and we verify with supabase.auth.verifyOtp.
 */
import { useCallback, useEffect, useState } from 'react';
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
import { useRouter } from 'expo-router';
import {
  Text,
  Heading,
  SectionLabel,
  Button,
  Card,
  BottomActionBar,
} from '@/components';
import { colors, layout } from '@/design';
import { useAuthStore } from '@/store/auth';
import { SUPABASE_AVAILABLE } from '@/lib/supabase';
import {
  addMember,
  listMembers,
  removeMember,
  resolveOwnerId,
  type HouseholdMember,
} from '@/lib/household';
import { getActiveOwnerId } from '@/lib/sync';

export default function SignIn() {
  const router = useRouter();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const ready = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const pendingEmail = useAuthStore((s) => s.pendingEmail);
  const sendCode = useAuthStore((s) => s.sendCode);
  const verifyCode = useAuthStore((s) => s.verifyCode);
  const signOut = useAuthStore((s) => s.signOut);
  const reset = useAuthStore((s) => s.reset);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  if (!SUPABASE_AVAILABLE) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <Header onClose={close} />
        <View style={styles.bodyCentered}>
          <Heading variant="screenTitle">Sync isn’t configured</Heading>
          <Text color="textMuted" style={styles.tipCenter}>
            This build has no Supabase URL/key. Stock still works locally —
            your data lives in this browser only.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Header onClose={close} />
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {!ready ? (
            <Text color="textMuted" style={styles.tipCenter}>
              loading…
            </Text>
          ) : user ? (
            <SignedIn
              userId={user.id}
              email={user.email ?? '(no email on session)'}
              busy={busy}
              onSignOut={signOut}
              onDone={close}
            />
          ) : pendingEmail ? (
            <EnterCode
              email={pendingEmail}
              code={code}
              setCode={setCode}
              error={error}
              busy={busy}
              onVerify={() => verifyCode(code)}
              onUseAnother={() => {
                setCode('');
                reset();
              }}
            />
          ) : (
            <SignInForm
              email={email}
              setEmail={setEmail}
              error={error}
              busy={busy}
              onSubmit={() => sendCode(email)}
              onSkip={close}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.modalHeader}>
      <Heading variant="screenTitle">Sign in</Heading>
      <Pressable onPress={onClose} hitSlop={8}>
        <Text variant="bodyStrong" color="textMuted">
          Close
        </Text>
      </Pressable>
    </View>
  );
}

function SignInForm({
  email,
  setEmail,
  error,
  busy,
  onSubmit,
  onSkip,
}: {
  email: string;
  setEmail: (s: string) => void;
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <Text color="textMuted" style={styles.tip}>
        Sign in to sync your recipes, plans, and pantry across devices. We’ll
        email you an 8-digit code — no password.
      </Text>

      <Card style={styles.formCard}>
        <SectionLabel color="textMuted">Email</SectionLabel>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          style={styles.input}
        />
        {error ? (
          <Text color="warn" style={styles.errorText}>
            {error}
          </Text>
        ) : null}
      </Card>

      <Text color="textFaint" style={styles.tipFaint}>
        Without signing in, Stock still works — your data stays in this
        browser only and won’t follow you to other devices.
      </Text>

      <BottomActionBar>
        <Button label="Skip" variant="secondary" flex onPress={onSkip} />
        <Button
          label={busy ? 'Sending…' : 'Send code'}
          glyph="next"
          flex
          disabled={busy || !email.trim()}
          onPress={onSubmit}
        />
      </BottomActionBar>
    </>
  );
}

function EnterCode({
  email,
  code,
  setCode,
  error,
  busy,
  onVerify,
  onUseAnother,
}: {
  email: string;
  code: string;
  setCode: (s: string) => void;
  error: string | null;
  busy: boolean;
  onVerify: () => void;
  onUseAnother: () => void;
}) {
  return (
    <>
      <Text color="textMuted" style={styles.tip}>
        We emailed an 8-digit code to{'\n'}
        <Text variant="bodyStrong">{email}</Text>
      </Text>

      <Card style={styles.formCard}>
        <SectionLabel color="textMuted">8-digit code</SectionLabel>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 8))}
          placeholder="••••••••"
          placeholderTextColor={colors.textFaint}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={8}
          style={[styles.input, styles.codeInput]}
        />
        {error ? (
          <Text color="warn" style={styles.errorText}>
            {error}
          </Text>
        ) : null}
      </Card>

      <Pressable onPress={onUseAnother} style={styles.linkRow}>
        <Text color="accent">Use a different email</Text>
      </Pressable>

      <BottomActionBar>
        <Button
          label={busy ? 'Verifying…' : 'Verify'}
          glyph="done"
          flex
          disabled={busy || code.trim().length < 6}
          onPress={onVerify}
        />
      </BottomActionBar>
    </>
  );
}

function SignedIn({
  userId,
  email,
  busy,
  onSignOut,
  onDone,
}: {
  userId: string;
  email: string;
  busy: boolean;
  onSignOut: () => void;
  onDone: () => void;
}) {
  return (
    <>
      <View style={styles.signedInHeader}>
        <Heading variant="screenTitle">You’re signed in</Heading>
        <Text color="textMuted" style={styles.tipCenter}>
          {email}
        </Text>
        <Text color="textFaint" style={styles.tipCenter}>
          Your recipes, plan, pantry, and shopping list sync to every device you
          sign in on.
        </Text>
      </View>

      <Household userId={userId} email={email} />

      <BottomActionBar>
        <Button
          label={busy ? 'Signing out…' : 'Sign out'}
          variant="secondary"
          flex
          disabled={busy}
          onPress={onSignOut}
        />
        <Button label="Done" glyph="done" flex onPress={onDone} />
      </BottomActionBar>
    </>
  );
}

/**
 * Share this kitchen with someone you live with. Adding an email grants that
 * account the same recipes, pantry, plan, and shopping list — one kitchen, two
 * logins. Calorie pushes stay personal and are not shared.
 *
 * You can add someone before they've ever opened Stock: membership is matched
 * on email at sign-in, not on an account that has to exist first.
 */
function Household({ userId, email }: { userId: string; email: string }) {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    // The sync layer already resolved this at sign-in; only pay for a lookup
    // when it hasn't (sync off, or this screen opened mid-start).
    const owner = getActiveOwnerId() ?? (await resolveOwnerId(userId, email));
    setOwnerId(owner);
    if (owner === userId) setMembers(await listMembers(userId));
    setLoading(false);
  }, [userId, email]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!SUPABASE_AVAILABLE) return null;

  if (loading) {
    return (
      <Card style={styles.formCard}>
        <SectionLabel color="textMuted">Kitchen</SectionLabel>
        <Text color="textFaint">Checking…</Text>
      </Card>
    );
  }

  // Member of someone else's household — nothing to manage, just say so.
  if (ownerId && ownerId !== userId) {
    return (
      <Card style={styles.formCard}>
        <SectionLabel color="textMuted">Kitchen</SectionLabel>
        <Text variant="bodyStrong">You’re in a shared kitchen</Text>
        <Text color="textMuted" style={styles.tip}>
          The recipes, pantry, plan, and shopping list you see belong to the
          household you were added to. Anything you change, they see too.
        </Text>
        <Text color="textFaint" style={styles.tipFaint}>
          What you cook still logs calories to your own account, not theirs.
        </Text>
      </Card>
    );
  }

  const submit = async () => {
    setWorking(true);
    setError(null);
    setNote(null);
    const res = await addMember(userId, invite);
    if (!res.ok) {
      setError(res.error);
    } else {
      setInvite('');
      setNote(
        'Added. They’ll see your kitchen the next time they open Stock — if they’re already signed in, have them reload.',
      );
      setMembers(await listMembers(userId));
    }
    setWorking(false);
  };

  const drop = async (memberEmail: string) => {
    setWorking(true);
    setError(null);
    setNote(null);
    const res = await removeMember(userId, memberEmail);
    if (!res.ok) setError(res.error);
    else setMembers(await listMembers(userId));
    setWorking(false);
  };

  return (
    <Card style={styles.formCard}>
      <SectionLabel color="textMuted">Share this kitchen</SectionLabel>
      <Text color="textMuted" style={styles.tip}>
        Add someone you live with and you’ll both use one kitchen — same
        recipes, same pantry, same shopping list, updating live on both phones.
      </Text>

      {members.length > 0 ? (
        <View style={styles.memberList}>
          {members.map((m) => (
            <View key={m.email} style={styles.memberRow}>
              <Text style={styles.memberEmail} numberOfLines={1}>
                {m.email}
              </Text>
              <Pressable
                onPress={() => void drop(m.email)}
                disabled={working}
                hitSlop={8}>
                <Text color="warn">Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <TextInput
        value={invite}
        onChangeText={setInvite}
        placeholder="their@email.com"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        style={styles.input}
      />

      {error ? (
        <Text color="warn" style={styles.errorText}>
          {error}
        </Text>
      ) : null}
      {note ? (
        <Text color="textMuted" style={styles.errorText}>
          {note}
        </Text>
      ) : null}

      <Button
        label={working ? 'Sharing…' : 'Share kitchen'}
        variant="secondary"
        disabled={working || !invite.trim()}
        onPress={() => void submit()}
      />

      <Text color="textFaint" style={styles.tipFaint}>
        They sign in with their own email and their own code. Calories stay
        personal — each of you logs to your own day.
      </Text>
    </Card>
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
  body: { paddingHorizontal: layout.screenPadding, paddingBottom: 28, gap: 18 },
  bodyCentered: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 40,
    alignItems: 'center',
    gap: 14,
  },
  tip: { lineHeight: 21, paddingTop: 6 },
  tipCenter: { textAlign: 'center', lineHeight: 21 },
  tipFaint: { fontStyle: 'italic', lineHeight: 19 },
  formCard: { gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  codeInput: {
    textAlign: 'center',
    fontSize: 24,
    letterSpacing: 8,
    fontVariant: ['tabular-nums'],
  },
  errorText: { fontStyle: 'italic', paddingTop: 4 },
  linkRow: { paddingTop: 18 },
  signedInHeader: {
    paddingTop: 28,
    paddingBottom: 6,
    alignItems: 'center',
    gap: 12,
  },
  memberList: { gap: 2, paddingVertical: 4 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  memberEmail: { flexShrink: 1 },
});
