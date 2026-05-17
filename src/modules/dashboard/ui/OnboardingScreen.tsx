import React, { useRef } from 'react';
import {
  Animated,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { AppTheme } from '../../settings';

type OnboardingScreenProps = {
  activeTheme: AppTheme;
  onStart: () => Promise<void>;
  onSkip: () => void;
};

function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;

  return {
    animatedStyle: {
      transform: [{ scale }],
    },
    pressIn: () => {
      Animated.spring(scale, {
        friction: 7,
        tension: 150,
        toValue: 0.95,
        useNativeDriver: true,
      }).start();
    },
    pressOut: () => {
      Animated.spring(scale, {
        friction: 6,
        tension: 150,
        toValue: 1,
        useNativeDriver: true,
      }).start();
    },
  };
}

// ─── Simulated Blurry Concentric Glows (Apple Liquid Glass) ───

const RadialGlowTop = () => (
  <View style={styles.glowTopContainer} pointerEvents="none">
    <View style={[styles.glowTopCircle, { width: 500, height: 500, borderRadius: 250, opacity: 0.02 }]} />
    <View style={[styles.glowTopCircle, { width: 400, height: 400, borderRadius: 200, opacity: 0.04 }]} />
    <View style={[styles.glowTopCircle, { width: 300, height: 300, borderRadius: 150, opacity: 0.07 }]} />
    <View style={[styles.glowTopCircle, { width: 200, height: 200, borderRadius: 100, opacity: 0.12 }]} />
    <View style={[styles.glowTopCircle, { width: 100, height: 100, borderRadius: 50, opacity: 0.18 }]} />
  </View>
);

const RadialGlowBottom = () => (
  <View style={styles.glowBottomContainer} pointerEvents="none">
    <View style={[styles.glowBottomCircle, { width: 450, height: 450, borderRadius: 225, opacity: 0.02 }]} />
    <View style={[styles.glowBottomCircle, { width: 350, height: 350, borderRadius: 175, opacity: 0.05 }]} />
    <View style={[styles.glowBottomCircle, { width: 250, height: 250, borderRadius: 125, opacity: 0.08 }]} />
    <View style={[styles.glowBottomCircle, { width: 150, height: 150, borderRadius: 75, opacity: 0.13 }]} />
    <View style={[styles.glowBottomCircle, { width: 80, height: 80, borderRadius: 40, opacity: 0.20 }]} />
  </View>
);

// ─── Custom Vector Icons matching Material Symbols ───

const WalletIcon = () => (
  <View style={styles.walletContainer}>
    {/* Sticking Card */}
    <View style={styles.walletCard} />
    {/* Main Body */}
    <View style={styles.walletBody}>
      {/* Clasp */}
      <View style={styles.walletClasp}>
        <View style={styles.walletClaspDot} />
      </View>
    </View>
  </View>
);

const SmsIcon = () => (
  <View style={styles.smsContainer}>
    <View style={styles.smsBubble}>
      <View style={styles.smsDotRow}>
        <View style={styles.smsDot} />
        <View style={styles.smsDot} />
        <View style={styles.smsDot} />
      </View>
      <View style={styles.smsTail} />
    </View>
  </View>
);

const AutoAwesomeIcon = () => (
  <View style={styles.starsContainer}>
    <Text style={[styles.starIconText, styles.starIconBig]}>✦</Text>
    <Text style={[styles.starIconText, styles.starIconSmall]}>✦</Text>
  </View>
);

const MonitoringIcon = () => (
  <View style={styles.monitoringContainer}>
    <View style={styles.chartBar1} />
    <View style={styles.chartBar2} />
    <View style={styles.chartBar3} />
    {/* Trend arrow indicator */}
    <View style={styles.chartArrowLine} />
    <View style={styles.chartArrowHead} />
  </View>
);

export function OnboardingScreen({
  activeTheme,
  onStart,
  onSkip,
}: OnboardingScreenProps) {
  const isDark = activeTheme === 'dark';
  const startPress = usePressScale();
  const skipPress = usePressScale();

  return (
    <View style={styles.screen}>
      {/* 1. Base Dark/Light Screen Background (Rendered first in JSX stack for perfect Z-order) */}
      <View style={[StyleSheet.absoluteFill, isDark ? styles.screenDark : styles.screenLight]} pointerEvents="none" />

      {/* 2. Concentric Radial Liquid Glows (Pure premium Apple Glass background glows) */}
      <RadialGlowTop />
      <RadialGlowBottom />

      {/* 3. Futuristic Geometric Network Background Image Overlay */}
      <View style={styles.backgroundImageWrapper} pointerEvents="none">
        <Image
          alt="Futuristic data background"
          source={{
            uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDArkPQW95409OcKj2a73jgR6l0JpAKxwcSnTccTB18B8nzf3G3AHhSvEsyIvgUBaNow8g5BSmxtR9PAonXaKwPcxzhw1o2rh11OaZdj6MUDvgm8KoQNSoBIjOPJw1Xj3anQQCauzoYZv0eb6ltFASaewP3Lb40PvpCP43_ePqz-hQtv_fsvfPhddnirO-VW_fORGY-KUqqmOP6F1QvVtm7OvNz4_DyE_wwJ5CXYqa2Si7IVnm9L9FataOdahzFRHto0EK1D6JsKzTn',
          }}
          style={[styles.backgroundImage, { opacity: isDark ? 0.35 : 0.08 }]}
        />
      </View>

      {/* 4. Floating Glassmorphism Mockups Layer */}
      <View style={styles.floatingContainer} pointerEvents="none">
        {/* Floating Card 1 */}
        <View style={[styles.floatingCard, styles.floatingCard1]}>
          <View style={styles.skeletonChip} />
          <View style={styles.skeletonLine1} />
          <View style={styles.skeletonLine2} />
        </View>

        {/* Floating Card 2 */}
        <View style={[styles.floatingCard, styles.floatingCard2]}>
          <View style={styles.skeletonRow}>
            <View style={styles.skeletonCircle} />
            <View style={styles.skeletonPill} />
          </View>
          <View style={styles.skeletonLineFull} />
        </View>
      </View>

      {/* 5. Safe Area and Scrollable Content Layer (On top, transparent background) */}
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          
          {/* Logo Section */}
          <View style={styles.logoSection}>
            <View style={styles.logoWrapper}>
              <View style={styles.logoGlow} />
              <View style={styles.logoCard}>
                <WalletIcon />
              </View>
            </View>
            <Text style={styles.logoTitle}>SmartFin</Text>
            <Text style={styles.logoSubtitle}>
              Finanzas personales en piloto automático
            </Text>
          </View>

          {/* Onboarding Steps */}
          <View style={styles.stepsContainer}>
            {/* Step 1 */}
            <View style={styles.stepCard}>
              <View style={[styles.stepIconWrapper, styles.stepIconSms]}>
                <SmsIcon />
              </View>
              <View style={styles.stepTextContainer}>
                <Text style={styles.stepTitle}>1. Conecta con SmartFin</Text>
                <Text style={styles.stepDescription}>
                  Otorga permisos de SMS y notificaciones para empezar la magia.
                </Text>
              </View>
            </View>

            {/* Step 2 */}
            <View style={styles.stepCard}>
              <View style={[styles.stepIconWrapper, styles.stepIconAuto]}>
                <AutoAwesomeIcon />
              </View>
              <View style={styles.stepTextContainer}>
                <Text style={styles.stepTitle}>2. Detección Inteligente</Text>
                <Text style={styles.stepDescription}>
                  SmartFin detecta automáticamente tus movimientos bancarios en
                  tiempo real.
                </Text>
              </View>
            </View>

            {/* Step 3 */}
            <View style={styles.stepCard}>
              <View style={[styles.stepIconWrapper, styles.stepIconMonitor]}>
                <MonitoringIcon />
              </View>
              <View style={styles.stepTextContainer}>
                <Text style={styles.stepTitle}>3. Control Total</Text>
                <Text style={styles.stepDescription}>
                  Gestiona gastos, deudas, metas y patrimonio desde un solo lugar.
                </Text>
              </View>
            </View>
          </View>

          {/* Action Area */}
          <View style={styles.actionArea}>
            <Animated.View style={startPress.animatedStyle}>
              <Pressable
                onPress={onStart}
                onPressIn={startPress.pressIn}
                onPressOut={startPress.pressOut}
                style={styles.startButton}>
                <Text style={styles.startButtonText}>Empezar</Text>
              </Pressable>
            </Animated.View>

            <Animated.View style={skipPress.animatedStyle}>
              <Pressable
                onPress={onSkip}
                onPressIn={skipPress.pressIn}
                onPressOut={skipPress.pressOut}
                style={[
                  styles.skipButton,
                  isDark ? styles.skipButtonDark : styles.skipButtonLight,
                ]}>
                <Text
                  style={[
                    styles.skipButtonText,
                    isDark ? styles.skipButtonTextDark : styles.skipButtonTextLight,
                  ]}>
                  Saltar
                </Text>
              </Pressable>
            </Animated.View>
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // ─── Screen Base ───
  screen: {
    flex: 1,
  },
  screenDark: {
    backgroundColor: '#0d0b14', // Gorgeous Apple midnight indigo-violet base (not pitch black!)
  },
  screenLight: {
    backgroundColor: '#f6f5fa',
  },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 40,
    paddingHorizontal: 20, // container-padding-mobile
    paddingTop: 48,
  },

  // ─── Simulated Blurry Concentric Glows (Top) ───
  glowTopContainer: {
    alignItems: 'center',
    height: 500,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -250,
    position: 'absolute',
    top: '5%',
    width: 500,
  },
  glowTopCircle: {
    backgroundColor: '#3d5afe', // Neon Blue
    position: 'absolute',
  },

  // ─── Simulated Blurry Concentric Glows (Bottom) ───
  glowBottomContainer: {
    alignItems: 'center',
    bottom: '5%',
    height: 450,
    justifyContent: 'center',
    position: 'absolute',
    right: -100,
    width: 450,
  },
  glowBottomCircle: {
    backgroundColor: '#8203d5', // Neon Violet
    position: 'absolute',
  },

  // ─── Visual Background Pattern Image Overlay ───
  backgroundImageWrapper: {
    ...StyleSheet.absoluteFill,
  },
  backgroundImage: {
    height: '100%',
    resizeMode: 'cover',
    width: '100%',
  },

  // ─── Floating Elements Layer ───
  floatingContainer: {
    ...StyleSheet.absoluteFill,
  },
  floatingCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)', // glass-card
    borderColor: 'rgba(255, 255, 255, 0.15)', // transparent white border
    borderRadius: 14, // rounded-xl
    borderWidth: 1.2,
    padding: 16,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { height: 16, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 8,
  },
  floatingCard1: {
    height: 120,
    right: -28,
    top: '12%',
    transform: [{ rotate: '12deg' }],
    width: 190,
  },
  skeletonChip: {
    backgroundColor: 'rgba(187, 195, 255, 0.2)', // primary/20
    borderRadius: 6,
    height: 20,
    marginBottom: 12,
    width: 40,
  },
  skeletonLine1: {
    backgroundColor: 'rgba(197, 197, 217, 0.15)', // on-surface-variant/20
    borderRadius: 4,
    height: 10,
    marginBottom: 8,
    width: '75%',
  },
  skeletonLine2: {
    backgroundColor: 'rgba(197, 197, 217, 0.15)', // on-surface-variant/20
    borderRadius: 4,
    height: 10,
    width: '50%',
  },

  // ─── Floating Card 2 ───
  floatingCard2: {
    height: 104,
    left: -36,
    top: '52%',
    transform: [{ rotate: '-6deg' }],
    width: 170,
  },
  skeletonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    width: '100%',
  },
  skeletonCircle: {
    backgroundColor: 'rgba(205, 189, 255, 0.25)', // secondary/30
    borderRadius: 12,
    height: 24,
    width: 24,
  },
  skeletonPill: {
    backgroundColor: 'rgba(0, 228, 117, 0.15)', // tertiary/20
    borderRadius: 6,
    height: 10,
    width: 44,
  },
  skeletonLineFull: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 4,
    height: 6,
    width: '100%',
  },

  // ─── Logo Section ───
  logoSection: {
    alignItems: 'center',
    marginBottom: 44,
  },
  logoWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  logoGlow: {
    backgroundColor: 'rgba(187, 195, 255, 0.25)', // primary/20
    borderRadius: 48,
    height: 96,
    position: 'absolute',
    width: 96,
    shadowColor: '#bbc3ff',
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
  },
  logoCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.07)', // glass-card
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 20, // rounded-2xl
    borderWidth: 1.5,
    height: 80,
    justifyContent: 'center',
    width: 80,
    shadowColor: '#000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  logoTitle: {
    color: '#ffffff',
    fontSize: 28, // headline-lg-mobile
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  logoSubtitle: {
    color: '#bbc3ff', // primary (#bbc3ff)
    fontSize: 20, // title-md
    fontWeight: '600',
    lineHeight: 28,
    maxWidth: 280,
    textAlign: 'center',
  },

  // ─── Custom Vector Wallet Icon Shape ───
  walletContainer: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  walletBody: {
    backgroundColor: 'transparent',
    borderColor: '#bbc3ff', // primary
    borderRadius: 6,
    borderWidth: 3,
    height: 28,
    justifyContent: 'center',
    width: 38,
  },
  walletCard: {
    backgroundColor: 'transparent',
    borderColor: '#bbc3ff',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    borderWidth: 3,
    height: 12,
    marginBottom: -6,
    width: 22,
  },
  walletClasp: {
    alignItems: 'center',
    backgroundColor: '#bbc3ff',
    borderBottomRightRadius: 4,
    borderTopRightRadius: 4,
    height: 12,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    top: 5,
    width: 10,
  },
  walletClaspDot: {
    backgroundColor: '#001d93', // on-primary
    borderRadius: 2,
    height: 4,
    width: 4,
  },

  // ─── Custom Vector SMS Icon Shape ───
  smsContainer: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  smsBubble: {
    borderColor: '#bbc3ff', // primary
    borderRadius: 4,
    borderWidth: 2,
    height: 15,
    justifyContent: 'center',
    width: 20,
  },
  smsDotRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    justifyContent: 'center',
  },
  smsDot: {
    backgroundColor: '#bbc3ff',
    borderRadius: 1,
    height: 2,
    width: 2,
  },
  smsTail: {
    borderBottomWidth: 2,
    borderColor: '#bbc3ff',
    borderLeftWidth: 2,
    bottom: -4,
    height: 5,
    left: 3,
    position: 'absolute',
    transform: [{ rotate: '45deg' }],
    width: 5,
  },

  // ─── Custom Vector Sparkles Icon Shape ───
  starsContainer: {
    height: 24,
    width: 24,
  },
  starIconText: {
    color: '#cdbdff', // secondary
    fontWeight: '800',
    position: 'absolute',
  },
  starIconBig: {
    fontSize: 20,
    left: 0,
    top: 0,
  },
  starIconSmall: {
    fontSize: 12,
    right: 0,
    top: -2,
  },

  // ─── Custom Vector Monitoring Icon Shape ───
  monitoringContainer: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 2.5,
    height: 20,
    width: 20,
  },
  chartBar1: {
    backgroundColor: '#00e475', // tertiary
    borderRadius: 1,
    height: 7,
    width: 3.5,
  },
  chartBar2: {
    backgroundColor: '#00e475',
    borderRadius: 1,
    height: 12,
    width: 3.5,
  },
  chartBar3: {
    backgroundColor: '#00e475',
    borderRadius: 1,
    height: 17,
    width: 3.5,
  },
  chartArrowLine: {
    backgroundColor: '#00e475',
    bottom: 2,
    height: 2,
    left: 1,
    position: 'absolute',
    transform: [{ rotate: '-40deg' }],
    width: 20,
  },
  chartArrowHead: {
    borderColor: 'transparent',
    borderLeftColor: '#00e475',
    borderLeftWidth: 4,
    borderTopColor: 'transparent',
    borderTopWidth: 4,
    position: 'absolute',
    right: -1,
    top: -2,
    transform: [{ rotate: '-45deg' }],
  },

  // ─── Onboarding Steps ───
  stepsContainer: {
    gap: 12, // card-gap
    marginBottom: 44,
    width: '100%',
  },
  stepCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)', // glass-card
    borderColor: 'rgba(255, 255, 255, 0.12)', // thin transparent border
    borderRadius: 16, // rounded-2xl
    borderWidth: 1.2,
    flexDirection: 'row',
    gap: 16, // gutter
    padding: 16, // p-gutter
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 15,
    elevation: 4,
  },
  stepIconWrapper: {
    alignItems: 'center',
    borderRadius: 12, // rounded-xl
    height: 44, // w-12/h-12
    justifyContent: 'center',
    width: 44,
  },
  stepIconSms: {
    backgroundColor: 'rgba(61, 90, 254, 0.18)', // bg-primary-container/20
  },
  stepIconAuto: {
    backgroundColor: 'rgba(82, 3, 213, 0.18)', // bg-secondary-container/20
  },
  stepIconMonitor: {
    backgroundColor: 'rgba(0, 127, 62, 0.18)', // bg-tertiary-container/20
  },
  stepTextContainer: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    color: '#ffffff',
    fontSize: 16, // body-lg font-bold
    fontWeight: '700',
  },
  stepDescription: {
    color: '#c5c5d9', // text-on-surface-variant
    fontSize: 14, // text-sm / body-md
    lineHeight: 18,
  },

  // ─── Action Area ───
  actionArea: {
    gap: 16,
    width: '100%',
  },
  startButton: {
    alignItems: 'center',
    backgroundColor: '#bbc3ff', // primary
    borderRadius: 100, // rounded-full
    height: 56, // py-4
    justifyContent: 'center',
    shadowColor: 'rgba(187, 195, 255, 0.3)', // shadow-primary/20
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 16,
    width: '100%',
  },
  startButtonText: {
    color: '#001d93', // text-on-primary
    fontSize: 18, // text-lg
    fontWeight: '700',
  },
  skipButton: {
    alignItems: 'center',
    borderRadius: 100,
    borderWidth: 1,
    height: 56,
    justifyContent: 'center',
    width: '100%',
  },
  skipButtonDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)', // bg-white/5
    borderColor: 'rgba(255, 255, 255, 0.12)', // border-white/10
  },
  skipButtonLight: {
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  skipButtonText: {
    fontSize: 18,
    fontWeight: '700',
  },
  skipButtonTextDark: {
    color: '#e5e2e3', // text-on-surface
  },
  skipButtonTextLight: {
    color: '#131314',
  },
});
