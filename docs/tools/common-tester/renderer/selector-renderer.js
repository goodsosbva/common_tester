function renderSelector(selector) {
  const kind = selector?.kind || selector?.strategy;
  if (!selector || !kind) {
    throw new Error('Selector is missing kind/strategy');
  }

  if (kind === 'role') {
    if (selector.nameRegex) {
      return `page.getByRole(${JSON.stringify(selector.role)}, { name: /${selector.nameRegex}/i })`;
    }

    if (selector.name) {
      return `page.getByRole(${JSON.stringify(selector.role)}, { name: ${JSON.stringify(selector.name)} })`;
    }

    return `page.getByRole(${JSON.stringify(selector.role)})`;
  }

  if (kind === 'label') {
    return `page.getByLabel(${JSON.stringify(selector.text)})`;
  }

  if (kind === 'testId') {
    return `page.getByTestId(${JSON.stringify(selector.value)})`;
  }

  if (kind === 'placeholder') {
    return `page.getByPlaceholder(${JSON.stringify(selector.value)})`;
  }

  if (kind === 'text') {
    return `page.getByText(${JSON.stringify(selector.text)})`;
  }

  if (kind === 'css') {
    return `page.locator(${JSON.stringify(selector.value)})`;
  }

  throw new Error(`Unsupported selector kind: ${kind}`);
}

module.exports = { renderSelector };
