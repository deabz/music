// Discord application-command limits, validated without registration or a token.
function validateCommands(definitions) {
  const errors = [], names = new Set();
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  const text = (value, max) => typeof value === "string" && value.length >= 1 && value.length <= max;
  function options(items, path, depth = 0) {
    if (!Array.isArray(items) || items.length > 25) { fail(path, "options must be an array of at most 25"); return; }
    let optional = false; const used = new Set();
    const nested = items.some(item => [1, 2].includes(item.type));
    for (const item of items) {
      const key = `${path}/${item.name}`;
      if (!text(item.name, 32) || !/^[\p{Ll}\p{Lm}\p{Lo}\p{N}_-]+$/u.test(item.name)) fail(key, "invalid option name");
      if (used.has(item.name)) fail(key, "duplicate option"); used.add(item.name);
      if (!text(item.description, 100)) fail(key, "invalid description");
      if (!Number.isInteger(item.type) || item.type < 1 || item.type > 11) fail(key, "invalid option type");
      if (nested && ![1, 2].includes(item.type)) fail(key, "cannot mix subcommands with parameters");
      if (item.required && optional) fail(key, "required option follows optional option");
      if (!item.required && item.type > 2) optional = true;
      if (item.options) {
        if (depth >= 2 || ![1, 2].includes(item.type)) fail(key, "invalid nesting");
        if (item.type === 2 && item.options.some(child => child.type !== 1)) fail(key, "group must contain subcommands");
        options(item.options, key, depth + 1);
      }
      if (item.choices) {
        if (![3, 4, 10].includes(item.type) || item.choices.length > 25 || item.autocomplete) fail(key, "invalid choices");
        for (const choice of item.choices) {
          if (!text(choice.name, 100)) fail(key, "invalid choice name");
          if (item.type === 3 ? !text(choice.value, 100) : !Number.isFinite(choice.value)) fail(key, "invalid choice value");
          if (item.type === 4 && !Number.isSafeInteger(choice.value)) fail(key, "integer choice must be a safe integer");
        }
      }
      if (item.channel_types && (item.type !== 7 || item.channel_types.some(type => ![0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 16].includes(type)))) fail(key, "invalid channel types");
    }
  }
  if (definitions.length > 100) fail("commands", "more than 100 slash commands");
  for (const definition of definitions) {
    const command = definition.toJSON ? definition.toJSON() : definition;
    if (!text(command.name, 32) || !/^[\p{Ll}\p{Lm}\p{Lo}\p{N}_-]+$/u.test(command.name)) fail(command.name, "invalid name");
    if (names.has(command.name)) fail(command.name, "duplicate command"); names.add(command.name);
    if (!text(command.description, 100)) fail(command.name, "invalid description");
    options(command.options || [], command.name);
  }
  return errors;
}
module.exports = { validateCommands };
