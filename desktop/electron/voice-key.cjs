// The voice typing shortcut: any key or combination Electron can register system-wide.
const DEFAULT = 'Control+Alt+Space';
const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Capslock|Numlock|Scrolllock|Backspace|Delete|Insert|Return|Up|Down|Left|Right|Home|End|PageUp|PageDown|PrintScreen|num[0-9]|numdec|numadd|numsub|nummult|numdiv|Media(?:NextTrack|PreviousTrack|Stop|PlayPause)|Volume(?:Up|Down|Mute)|Plus|[-=\[\];',.\/\\`])$/;
function valid(accelerator) {
  if (typeof accelerator !== 'string' || accelerator.length > 60) return false;
  const parts = accelerator.split('+'), key = parts.pop();
  return KEY.test(key) && parts.every(p => ['Control', 'Alt', 'Shift', 'Super'].includes(p)) && new Set(parts).size === parts.length;
}
const of = ui => valid(ui?.voiceShortcut) ? ui.voiceShortcut : DEFAULT;
module.exports = { DEFAULT, valid, of };
