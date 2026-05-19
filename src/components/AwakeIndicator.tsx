import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors } from '@/design';

/**
 * Wake-lock status pip (spec §7 "● awake"). The screen calls
 * expo-keep-awake's useKeepAwake(); this just surfaces the state.
 */
export function AwakeIndicator({ active = true }: { active?: boolean }) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.dot, { backgroundColor: active ? colors.ok : colors.textFaint }]} />
      <Text variant="sectionLabel" color={active ? 'ok' : 'textFaint'}>
        awake
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});

export default AwakeIndicator;
