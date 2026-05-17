import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export type BottomNavigationTab =
  | 'home'
  | 'transactions'
  | 'budgets'
  | 'net-worth'
  | 'more';

type BottomNavigationItem = {
  id: BottomNavigationTab;
  icon: string;
  label: string;
};

type BottomNavigationProps = {
  activeTab: BottomNavigationTab;
  bottomInset: number;
  colorScheme: 'dark' | 'light';
  onTabPress: (tab: BottomNavigationTab) => void;
  style?: StyleProp<ViewStyle>;
};

const bottomNavigationItems: BottomNavigationItem[] = [
  {
    id: 'home',
    icon: '⌂',
    label: 'Inicio',
  },
  {
    id: 'transactions',
    icon: '▤',
    label: 'Movimientos',
  },
  {
    id: 'budgets',
    icon: '▣',
    label: 'Presupuestos',
  },
  {
    id: 'net-worth',
    icon: '↗',
    label: 'Patrimonio',
  },
  {
    id: 'more',
    icon: '•••',
    label: 'Más',
  },
];

function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;

  return {
    animatedStyle: {
      transform: [{ scale }],
    },
    pressIn: () => {
      Animated.spring(scale, {
        friction: 7,
        tension: 120,
        toValue: 0.92,
        useNativeDriver: true,
      }).start();
    },
    pressOut: () => {
      Animated.spring(scale, {
        friction: 6,
        tension: 120,
        toValue: 1,
        useNativeDriver: true,
      }).start();
    },
  };
}

export function BottomNavigation({
  activeTab,
  bottomInset,
  colorScheme,
  onTabPress,
  style,
}: BottomNavigationProps) {
  const isDark = colorScheme === 'dark';

  return (
    <View
      style={[
        styles.bottomNavigation,
        isDark ? styles.bottomNavigationDark : styles.bottomNavigationLight,
        { bottom: Math.max(bottomInset, 16) },
        style,
      ]}>
      {bottomNavigationItems.map(item => {
        const isActive = item.id === activeTab;

        return (
          <BottomNavigationButton
            key={item.id}
            isActive={isActive}
            isDark={isDark}
            item={item}
            onPress={() => onTabPress(item.id)}
          />
        );
      })}
    </View>
  );
}

function BottomNavigationButton({
  isActive,
  isDark,
  item,
  onPress,
}: {
  isActive: boolean;
  isDark: boolean;
  item: BottomNavigationItem;
  onPress: () => void;
}) {
  const pressScale = usePressScale();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      onPressIn={pressScale.pressIn}
      onPressOut={pressScale.pressOut}
      style={styles.bottomNavigationItem}>
      <Animated.View
        style={[
          styles.bottomNavigationIcon,
          isActive ? (isDark ? styles.bottomNavigationIconActiveDark : styles.bottomNavigationIconActiveLight) : null,
          pressScale.animatedStyle,
        ]}>
        <Text
          style={[
            styles.bottomNavigationIconText,
            isDark
              ? styles.bottomNavigationIconTextDark
              : styles.bottomNavigationIconTextLight,
            isActive ? (isDark ? styles.bottomNavigationIconTextActiveDark : styles.bottomNavigationIconTextActiveLight) : null,
          ]}>
          {item.icon}
        </Text>
      </Animated.View>
      {isActive && <View style={[styles.activeDot, { backgroundColor: isDark ? '#bbc3ff' : '#2848ee' }]} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bottomNavigation: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 24,
    borderWidth: 1,
    elevation: 20,
    flexDirection: 'row',
    height: 60,
    justifyContent: 'space-around',
    left: 20,
    maxWidth: 520,
    paddingHorizontal: 8,
    position: 'absolute',
    right: 20,
    shadowColor: '#000000',
    shadowOffset: {
      height: 10,
      width: 0,
    },
    shadowOpacity: 0.35,
    shadowRadius: 20,
  },
  bottomNavigationDark: {
    backgroundColor: 'rgba(26, 24, 33, 0.88)', // Sleek dark solid glass
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  bottomNavigationLight: {
    backgroundColor: 'rgba(244, 243, 248, 0.92)', // Light solid glass
    borderColor: 'rgba(40, 72, 238, 0.16)',
  },
  bottomNavigationItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
  },
  bottomNavigationIcon: {
    alignItems: 'center',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    width: 46,
  },
  bottomNavigationIconActiveDark: {
    backgroundColor: 'rgba(205, 189, 255, 0.25)', // Elegant glowing neon background
  },
  bottomNavigationIconActiveLight: {
    backgroundColor: 'rgba(40, 72, 238, 0.12)', // Soft elegant active blue bubble
  },
  bottomNavigationIconText: {
    fontSize: 20,
    fontWeight: '800',
  },
  bottomNavigationIconTextDark: {
    color: 'rgba(255, 255, 255, 0.5)',
  },
  bottomNavigationIconTextLight: {
    color: 'rgba(0, 0, 0, 0.5)',
  },
  bottomNavigationIconTextActiveDark: {
    color: '#bbc3ff',
  },
  bottomNavigationIconTextActiveLight: {
    color: '#2848ee',
  },
  activeDot: {
    borderRadius: 3,
    height: 4,
    marginTop: 2,
    width: 4,
  },
});
