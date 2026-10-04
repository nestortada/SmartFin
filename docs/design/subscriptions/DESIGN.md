---
name: Liquid Intelligence Finance
colors:
  surface: '#131314'
  surface-dim: '#131314'
  surface-bright: '#3a393a'
  surface-container-lowest: '#0e0e0f'
  surface-container-low: '#1c1b1c'
  surface-container: '#201f20'
  surface-container-high: '#2a2a2b'
  surface-container-highest: '#353436'
  on-surface: '#e5e2e3'
  on-surface-variant: '#c5c5d9'
  inverse-surface: '#e5e2e3'
  inverse-on-surface: '#313031'
  outline: '#8e8fa2'
  outline-variant: '#444656'
  surface-tint: '#bbc3ff'
  primary: '#bbc3ff'
  on-primary: '#001d93'
  primary-container: '#3d5afe'
  on-primary-container: '#f1f0ff'
  inverse-primary: '#2848ee'
  secondary: '#cdbdff'
  on-secondary: '#370096'
  secondary-container: '#5203d5'
  on-secondary-container: '#c0acff'
  tertiary: '#00e475'
  on-tertiary: '#003918'
  tertiary-container: '#007f3e'
  on-tertiary-container: '#c8ffcf'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dee0ff'
  primary-fixed-dim: '#bbc3ff'
  on-primary-fixed: '#000f5d'
  on-primary-fixed-variant: '#002ccd'
  secondary-fixed: '#e8deff'
  secondary-fixed-dim: '#cdbdff'
  on-secondary-fixed: '#20005f'
  on-secondary-fixed-variant: '#4f00d0'
  tertiary-fixed: '#62ff96'
  tertiary-fixed-dim: '#00e475'
  on-tertiary-fixed: '#00210b'
  on-tertiary-fixed-variant: '#005226'
  background: '#131314'
  on-background: '#e5e2e3'
  surface-variant: '#353436'
typography:
  display-lg:
    fontFamily: Manrope
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  title-md:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Manrope
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Manrope
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  container-padding-mobile: 20px
  container-padding-desktop: 32px
  gutter: 16px
  card-gap: 12px
---

## Brand & Style
The design system embodies a "Liquid Glass" aesthetic—a sophisticated fusion of high-end glassmorphism and Material 3's expressive layout logic. It is designed to feel like a premium, high-tech instrument that is both weightless and incredibly secure. 

The visual narrative centers on **translucency and depth**. Elements should appear as if they are floating in a multi-layered dark space, utilizing background blurs and subtle reflections to suggest physical presence. The interface prioritizes an "intelligent" feel through automated data visualizations and high-contrast focal points, ensuring the user feels in total control of their financial data, which remains entirely private and on-device.

## Colors
The palette is rooted in a **Deep Black** (#0A0A0B) foundation to maximize the "Liquid Glass" effect and OLED efficiency. 

- **Primary (Royal Blue):** Used for main actions, active states, and primary brand moments. 
- **Secondary (Violet):** Used for accent details, wealth-building features, and secondary data visualizations.
- **Tertiary (Mint Green):** Reserved for "positive" financial indicators (income, growth, savings) and success states.
- **Gradients:** Use linear gradients (45-degree angle) blending Primary to Secondary for high-impact surfaces like progress rings or hero cards.
- **Glass Surfaces:** Layers are created using white or primary-tinted overlays at 4% to 12% opacity with a 20px to 40px backdrop blur.

## Typography
**Manrope** is the exclusive typeface for the design system. Its geometric yet warm construction provides the refined, modern look necessary for a premium finance tool.

- **Currency Formatting:** Large financial figures (COP) should use `display-lg` with "ExtraBold" weight. Use a slightly smaller font size for the currency symbol ($) and decimals to maintain a clear hierarchy.
- **Readability:** Maintain high contrast for body text (use White at 90% opacity). Never use pure grey on glass backgrounds; instead, use the primary color at very low opacity to tint the text for a harmonious "liquid" feel.
- **Alignment:** All numerical data in tables should be tabular-lined to ensure vertical alignment of decimal points.

## Layout & Spacing
The layout follows a **Fluid Grid** model heavily influenced by Material 3. 

- **Responsive Behavior:** Use a 4-column grid for mobile and 12-column for tablet/desktop. 
- **Margins:** Generous 20px side margins on mobile to allow the "floating" cards to breathe against the screen edges.
- **Vertical Rhythm:** Elements are spaced in increments of 8px. Use 32px or 48px sections to separate major financial categories (e.g., Accounts vs. Recent Transactions).
- **Safe Areas:** Ensure the floating bottom navigation bar does not obscure critical data or action buttons; provide a 100px bottom padding on all scrollable views.

## Elevation & Depth
Depth is not communicated through traditional drop shadows, but through **Backdrop Blurs** and **Inner Glows**.

- **Surface Tiers:** 
    - **L1 (Base):** Deep Black background.
    - **L2 (Cards):** 8% White opacity + 32px Backdrop Blur + 1px subtle white top-border (reflection).
    - **L3 (Modals/Overlays):** 12% White opacity + 64px Backdrop Blur + subtle Primary-tinted outer glow.
- **Reflections:** Apply a very thin (0.5pt to 1pt) stroke to the top and left edges of glass cards to simulate a light source from the top-left, enhancing the "Liquid Glass" tactility.

## Shapes
The design system utilizes **Expressive Rounding** to soften the technical nature of finance.

- **Component Radius:** Standard buttons and inputs use the base 0.5rem (8px).
- **Container Radius:** Cards and major sections use `rounded-xl` (1.5rem / 24px) to create the soft, "friendly" look requested.
- **Floating Nav:** The bottom navigation bar uses a full pill shape (100px radius) to emphasize its detached, floating nature.
- **Data Visualization:** Line charts should use "Monotone" interpolation (smooth curves) rather than jagged lines. Progress rings should have rounded caps.

## Components
- **Floating Bottom Nav:** A pill-shaped translucent container. Active icons use a Primary-to-Secondary gradient fill; inactive icons are outlined and 50% opaque.
- **Large Action Buttons:** High-contrast, solid fills. The primary "Transaccionar" or "Ahorrar" buttons should use a vibrant Royal Blue background with white bold text.
- **Translucent Cards:** Used for account balances and spending summaries. They must include the 1px "reflection" top-stroke and a 32px blur.
- **Chips:** Small, highly rounded elements for categories (e.g., "Transporte", "Comida"). Use Secondary-tinted backgrounds (15% opacity) with solid colored text.
- **Progress Rings:** Large, thick strokes (12pt+) for financial goals. Use the Mint Green color for "Savings Goals" and Royal Blue for "Budget Tracking."
- **Input Fields:** Minimalist design with only a bottom border that glows in the Primary color when focused. No solid backgrounds unless they are the "Glass" card type.
- **Donut Charts:** Used for expense distribution. Ensure segments have a 2px gap between them to maintain the "clean and modern" aesthetic.