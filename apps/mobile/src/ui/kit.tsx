import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { usePrefs } from '../prefs';
import { Icon, type IconName } from './Icon';

/** Shared building blocks. Text scales with the system font size (capped so layouts stay usable). */
const MAX_SCALE = 1.8;
type Variant = 'title' | 'heading' | 'body' | 'label' | 'caption';
const sizes: Record<Variant, TextStyle> = {
  title: { fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.5 },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 17 },
};
export function AppText({ children, variant = 'body', muted, color, style, numberOfLines, selectable }: { children: ReactNode; variant?: Variant; muted?: boolean; color?: string; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean }) {
  const { colors } = usePrefs();
  return <Text maxFontSizeMultiplier={MAX_SCALE} numberOfLines={numberOfLines} selectable={selectable} style={[sizes[variant], { color: color ?? (muted ? colors.muted : colors.text) }, style]}>{children}</Text>;
}

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, accessibilityHint }: { title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; icon?: IconName; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; accessibilityHint?: string }) {
  const { colors } = usePrefs();
  const inactive = disabled || loading;
  const background = variant === 'primary' ? colors.accent : variant === 'danger' ? colors.dangerSoft : variant === 'secondary' ? colors.surface : 'transparent';
  const foreground = variant === 'primary' ? colors.onAccent : variant === 'danger' ? colors.danger : variant === 'ghost' ? colors.accentText : colors.text;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }} accessibilityHint={accessibilityHint} disabled={inactive} onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: background, borderColor: variant === 'secondary' ? colors.border : 'transparent', opacity: inactive ? 0.5 : pressed ? 0.85 : 1 }, style]}>
      {loading ? <ActivityIndicator color={foreground} /> : icon ? <Icon name={icon} color={foreground} size={20} /> : null}
      <Text maxFontSizeMultiplier={1.5} style={[styles.buttonText, { color: foreground }]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const { colors } = usePrefs();
  const base = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>{children}</Pressable>;
}

/** A scrollable, safe-area aware page; content is centred and width-limited on tablets. */
export function Screen({ children, refreshing, onRefresh, edges = ['top'], footer }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; edges?: Edge[]; footer?: ReactNode }) {
  const { colors } = usePrefs();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.screen}
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} /> : undefined}>
          <View style={styles.column}>{children}</View>
        </ScrollView>
        {footer ? <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}><View style={styles.column}>{footer}</View></View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Field({ label, error, hint, ...input }: TextInputProps & { label: string; error?: string; hint?: string }) {
  const { colors } = usePrefs();
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label" muted>{label}</AppText>
      <TextInput placeholderTextColor={colors.muted} maxFontSizeMultiplier={MAX_SCALE} accessibilityLabel={label}
        style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }]} {...input} />
      {error ? <AppText variant="caption" color={colors.danger}>{error}</AppText> : hint ? <AppText variant="caption" muted>{hint}</AppText> : null}
    </View>
  );
}

export function Banner({ tone = 'info', text, icon, action, onAction }: { tone?: 'info' | 'warning' | 'danger' | 'success'; text: string; icon?: IconName; action?: string; onAction?: () => void }) {
  const { colors } = usePrefs();
  const palette = { info: [colors.accentSoft, colors.accentText], warning: [colors.warningSoft, colors.warning], danger: [colors.dangerSoft, colors.danger], success: [colors.successSoft, colors.success] }[tone];
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: palette[0] }]}>
      <Icon name={icon ?? (tone === 'success' ? 'check' : 'alert')} color={palette[1]!} size={20} />
      <AppText style={{ flex: 1 }} color={colors.text}>{text}</AppText>
      {action && onAction ? <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}><AppText variant="label" color={palette[1]}>{action}</AppText></Pressable> : null}
    </View>
  );
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warning' }) {
  const { colors } = usePrefs();
  const [background, foreground] = { neutral: [colors.surfaceAlt, colors.text], accent: [colors.accentSoft, colors.accentText], success: [colors.successSoft, colors.success], danger: [colors.dangerSoft, colors.danger], warning: [colors.warningSoft, colors.warning] }[tone];
  return <View style={[styles.badge, { backgroundColor: background }]}><Text maxFontSizeMultiplier={1.5} style={{ color: foreground, fontSize: 12, fontWeight: '700' }}>{text}</Text></View>;
}

export function EmptyState({ icon, text, action, onAction }: { icon: IconName; text: string; action?: string; onAction?: () => void }) {
  const { colors } = usePrefs();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.accentSoft }]}><Icon name={icon} color={colors.accentText} size={28} /></View>
      <AppText muted style={{ textAlign: 'center' }}>{text}</AppText>
      {action && onAction ? <Button title={action} variant="secondary" onPress={onAction} /> : null}
    </View>
  );
}

/** Loading, error (with retry) or content — a query never leaves the screen spinning forever. */
export function QueryState({ loading, error, onRetry, children }: { loading: boolean; error: unknown; onRetry: () => void; children: ReactNode }) {
  const { t, errorText, colors } = usePrefs();
  if (loading) return <View style={styles.empty}><ActivityIndicator color={colors.accent} /><AppText muted>{t('loading')}</AppText></View>;
  if (error) return <View style={{ gap: 12 }}><Banner tone="danger" text={errorText(error)} /><Button title={t('retry')} icon="refresh" variant="secondary" onPress={onRetry} /></View>;
  return <>{children}</>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const { colors } = usePrefs();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => onChange(option.value)}
            style={[styles.chip, { backgroundColor: active ? colors.accent : colors.surface, borderColor: active ? colors.accent : colors.border }]}>
            <Text maxFontSizeMultiplier={1.5} style={{ color: active ? colors.onAccent : colors.text, fontWeight: '600', fontSize: 14 }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Row({ icon, label, value, onPress, danger }: { icon: IconName; label: string; value?: string; onPress?: () => void; danger?: boolean }) {
  const { colors } = usePrefs();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.row, { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
      <Icon name={icon} color={danger ? colors.danger : colors.accentText} />
      <View style={{ flex: 1 }}>
        <AppText color={danger ? colors.danger : undefined}>{label}</AppText>
        {value ? <AppText variant="caption" muted>{value}</AppText> : null}
      </View>
      {onPress ? <Icon name="chevron" color={colors.muted} size={18} /> : null}
    </Pressable>
  );
}

/**
 * Confirmation before an important action. With `reason` the user must type 3–500 characters
 * (or may leave it empty when `reasonOptional`). The confirm button is disabled while `busy`.
 */
export function ConfirmDialog({ visible, title, message, confirmLabel, destructive, reason, reasonOptional, busy, error, onConfirm, onCancel }: {
  visible: boolean; title: string; message?: string; confirmLabel?: string; destructive?: boolean; reason?: boolean; reasonOptional?: boolean; busy?: boolean; error?: string;
  onConfirm: (reason?: string) => void; onCancel: () => void;
}) {
  const { t, colors } = usePrefs();
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const reasonValid = !reason || (reasonOptional ? trimmed.length <= 500 : trimmed.length >= 3 && trimmed.length <= 500);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} onShow={() => setText('')}>
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <AppText variant="heading">{title}</AppText>
          {message ? <AppText muted>{message}</AppText> : null}
          {reason ? <Field label={reasonOptional ? t('offersReasonOptional') : t('reasonLabel')} hint={reasonOptional ? undefined : t('reasonHint')} value={text} onChangeText={setText} multiline maxLength={500} style={{ minHeight: 80, textAlignVertical: 'top' }} /> : null}
          {error ? <AppText variant="caption" color={colors.danger}>{error}</AppText> : null}
          <View style={styles.dialogActions}>
            <Button title={t('cancel')} variant="secondary" onPress={onCancel} style={{ flex: 1 }} disabled={busy} />
            <Button title={confirmLabel ?? t('confirm')} variant={destructive ? 'danger' : 'primary'} onPress={() => onConfirm(reason ? trimmed || undefined : undefined)} style={{ flex: 1 }} loading={busy} disabled={!reasonValid} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 52, borderRadius: 16, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  card: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 10 },
  screen: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  column: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 14 },
  footer: { padding: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  input: { minHeight: 50, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 32, paddingHorizontal: 12 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 40, borderRadius: 999, borderWidth: 1, paddingHorizontal: 16, justifyContent: 'center' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 480, alignSelf: 'center', borderRadius: 22, borderWidth: 1, padding: 20, gap: 14 },
  dialogActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  dropdown: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 },
  menu: { position: 'absolute', minWidth: 210, maxWidth: 300, borderRadius: 16, borderWidth: 1, paddingVertical: 6, boxShadow: '0 10px 28px rgba(0,0,0,0.18)' },
  menuItem: { minHeight: 46, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
});

/** A modal card around a small form; the content brings its own buttons (cancel included). */
export function Dialog({ visible, title, message, onClose, children }: { visible: boolean; title: string; message?: string; onClose: () => void; children: ReactNode }) {
  const { colors } = usePrefs();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
            <View style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <AppText variant="heading">{title}</AppText>
              {message ? <AppText muted>{message}</AppText> : null}
              {children}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A menu button showing the current choice; the list opens under it, aligned to its right edge. */
export function Dropdown<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  const { colors } = usePrefs();
  const { width } = useWindowDimensions();
  const anchor = useRef<ComponentRef<typeof View>>(null);
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const current = options.find(option => option.value === value) ?? options[0];
  const open = () => anchor.current?.measureInWindow((x, y, w, h) => setMenu({ top: y + h + 6, right: Math.max(12, width - (x + w)) }));
  const close = () => setMenu(null);
  return (
    <>
      <Pressable ref={anchor} accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? ''}`} accessibilityState={{ expanded: Boolean(menu) }} onPress={open}
        style={[styles.chip, styles.dropdown, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={{ color: colors.text, fontWeight: '600', fontSize: 14, flexShrink: 1 }}>{current?.label}</Text>
        <Icon name="down" color={colors.muted} size={18} />
      </Pressable>
      <Modal visible={Boolean(menu)} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel={label} />
        {menu ? (
          <View accessibilityRole="menu" style={[styles.menu, { top: menu.top, right: menu.right, backgroundColor: colors.surface, borderColor: colors.border }]}>
            {options.map(option => {
              const active = option.value === value;
              return (
                <Pressable key={option.value} accessibilityRole="menuitem" accessibilityState={{ selected: active }} onPress={() => { close(); if (!active) onChange(option.value); }}
                  style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}>
                  <Text maxFontSizeMultiplier={1.5} style={{ flex: 1, fontSize: 15, color: active ? colors.accentText : colors.text, fontWeight: active ? '700' : '500' }}>{option.label}</Text>
                  {active ? <Icon name="check" color={colors.accentText} size={18} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Modal>
    </>
  );
}
