/**
 * Magic-link sign-in. Signed in → cross-device sync turns on (Phase 2).
 * Signed out → app keeps working locally (existing IndexedDB path).
 *
 * The redirect URL is computed from window.location.origin so the same
 * build works on both localhost:8088/Stock/ and the deployed Pages site.
 * Both are allow-listed in the project's Auth → URL Configuration.
 */
import { useState } from 'react';
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

function redirectUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/Stock/`;
  }
  return 'https://nates123-cmd.github.io/Stock/';
}

export default function SignIn() {
  const router = useRouter();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const ready = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const pendingEmail = useAuthStore((s) => s.pendingEmail);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signOut = useAuthStore((s) => s.signOut);
  const reset = useAuthStore((s) => s.reset);

  const [email, setEmail] = useState('');

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
            <SignedIn email={user.email ?? '(no email on session)'} busy={busy} onSignOut={signOut} onDone={close} />
          ) : pendingEmail ? (
            <CheckInbox email={pendingEmail} onUseAnother={reset} />
          ) : (
            <SignInForm
              email={email}
              setEmail={setEmail}
              error={error}
              busy={busy}
              onSubmit={() => signInWithEmail(email, redirectUrl())}
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
        email you a one-click link — no password.
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
          label={busy ? 'Sending…' : 'Send magic link'}
          glyph="next"
          flex
          disabled={busy || !email.trim()}
          onPress={onSubmit}
        />
      </BottomActionBar>
    </>
  );
}

function CheckInbox({ email, onUseAnother }: { email: string; onUseAnother: () => void }) {
  return (
    <View style={styles.bodyCentered}>
      <Heading variant="screenTitle">Check your inbox</Heading>
      <Text color="textMuted" style={styles.tipCenter}>
        We sent a sign-in link to{'\n'}
        <Text variant="bodyStrong">{email}</Text>
      </Text>
      <Text color="textFaint" style={styles.tipCenter}>
        Open the link in the same browser you’re reading this in. You can
        close this tab — when you click the link it brings you back here
        signed in.
      </Text>
      <Pressable onPress={onUseAnother} style={styles.linkRow}>
        <Text color="accent">Use a different email</Text>
      </Pressable>
    </View>
  );
}

function SignedIn({
  email,
  busy,
  onSignOut,
  onDone,
}: {
  email: string;
  busy: boolean;
  onSignOut: () => void;
  onDone: () => void;
}) {
  return (
    <>
      <View style={styles.bodyCentered}>
        <Heading variant="screenTitle">You’re signed in</Heading>
        <Text color="textMuted" style={styles.tipCenter}>
          {email}
        </Text>
        <Text color="textFaint" style={styles.tipCenter}>
          Cross-device sync turns on with the next build step — your local
          data will be there waiting when it lands.
        </Text>
      </View>
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
  errorText: { fontStyle: 'italic', paddingTop: 4 },
  linkRow: { paddingTop: 18 },
});
