// New chat restarts the team of the open operation in a fresh one. Kept apart from engine.cjs so it can be tested.
//
// roster: [{ name, template, enlistedBy, stopped }] from the old operation.
// start(member): starts one agent (throws when its CLI is missing, an invalid name, ...).
// park(member): records an agent on the new operation without starting it (it shows as stopped).
// An agent that was stopped stays stopped, and one that fails to start is parked: one missing CLI (a stopped Gemini
// agent whose CLI is not installed) used to throw out of the whole reset after the boss had already restarted, so the
// window never switched to the new chat and New chat looked like it did nothing.
function restartRoster(roster, { start, park }) {
  const failed = [];
  for (const member of roster) {
    if (member.stopped) { park(member); continue; }
    try { start(member); }
    catch (e) { park(member); failed.push({ name: member.name, text: `${member.name} could not start: ${e?.message || e}` }); }
  }
  return failed;
}

module.exports = { restartRoster };
