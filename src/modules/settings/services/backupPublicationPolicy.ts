/** Release gate: root-only external readers and long capture waits require acceptance.
 * The tested publisher is callable by the isolated harness; UI activation is a separate decision.
 * See docs/atomicidad-financiera-fase5b2.md.
 */
export const BACKUP_PUBLICATION_UI_ENABLED = false;
