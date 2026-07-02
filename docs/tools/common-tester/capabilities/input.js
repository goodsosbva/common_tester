function stringFlag(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return ['1', 'true', 'yes', 'y'].includes(String(value).toLowerCase());
}

function buildInputSelector(command) {
  if (command.inputTestId) {
    return {
      kind: 'testId',
      value: command.inputTestId,
    };
  }

  if (command.inputLabel) {
    return {
      kind: 'label',
      text: command.inputLabel,
    };
  }

  if (command.inputRoleName) {
    return {
      kind: 'role',
      role: 'textbox',
      name: command.inputRoleName,
    };
  }

  if (command.inputSelector) {
    return {
      kind: 'css',
      value: command.inputSelector,
    };
  }

  return {
    kind: 'role',
    role: 'textbox',
    nameRegex: '검색|Search|Keyword|Name|Policy|Alarm',
  };
}

function buildInputCase(ctx) {
  const route = ctx.target.route || '/';
  const value = ctx.command.inputValue || 'common-tester-input';
  const selector = buildInputSelector(ctx.command);
  const executableDraft = stringFlag(ctx.command.draftExecutable);

  return {
    id: 'input-basic',
    capability: 'input',
    title: ctx.command.inputTitle || 'input field accepts text',
    route,
    generate: executableDraft,
    status: executableDraft ? 'draft_executable' : 'draft_waiting_for_mcp',
    selectorStatus: 'needs_mcp_verification',
    steps: [
      {
        kind: 'goto',
        url: route,
      },
      {
        kind: 'fill',
        selector,
        value,
      },
      {
        kind: 'expectValue',
        selector,
        value,
      },
    ],
  };
}

module.exports = { buildInputCase };
