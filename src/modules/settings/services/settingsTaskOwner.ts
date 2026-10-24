export type SettingsTaskOwner = {
  report: (message: string) => void;
  confirmed: (message: string) => void;
};

type Presentation = {
  busy: (message: string | undefined) => void;
  error: (message: string | undefined) => void;
  notice: (message: string | undefined) => void;
};

/** Synchronous admission; ownership survives screen navigation and late callbacks. */
export function createSettingsTaskRunner(presentation: Presentation) {
  let active: object | undefined;
  return async (message: string, task: (owner: SettingsTaskOwner) => Promise<void>): Promise<void> => {
    if (active) return;
    const token = {};
    active = token;
    let confirmation: string | undefined;
    const current = () => active === token;
    const owner: SettingsTaskOwner = {
      report: value => { if (current()) presentation.busy(value); },
      confirmed: value => {
        if (!current()) return;
        confirmation = value;
        presentation.notice(value);
      },
    };
    try {
      presentation.busy(message);
      presentation.error(undefined);
      presentation.notice(undefined);
      await task(owner);
    } catch (error) {
      if (current()) {
        const detail = error instanceof Error ? error.message : 'No se pudo completar la acción.';
        presentation.error(confirmation
          ? `${confirmation} No se pudo actualizar la presentación: ${detail}. No repitas la operación confirmada por este error.`
          : detail);
      }
    } finally {
      if (current()) {
        active = undefined;
        presentation.busy(undefined);
      }
    }
  };
}
