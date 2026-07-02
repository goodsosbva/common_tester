// @ts-nocheck
const {
  hashText,
  readYaml,
  writeYaml,
} = require('../context');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function koreanNumber(value) {
  const text = String(value || '').trim();
  const map = {
    한: 1,
    하나: 1,
    두: 2,
    둘: 2,
    세: 3,
    셋: 3,
    네: 4,
    넷: 4,
    다섯: 5,
  };
  return map[text] || Number(text);
}

function makeRule(unit, category, params, options = {}) {
  const basis = JSON.stringify({
    unitId: unit.unitId,
    category,
    params,
    text: String(unit.text || '').slice(0, 1000),
  });
  return {
    ruleId: `policy-rule-${hashText(basis).slice(0, 12)}`,
    capability: 'input',
    category,
    confidence: options.confidence || 'medium',
    params,
    suggestedExpansion: options.suggestedExpansion || {},
    sourceRef: {
      policyUnitId: unit.unitId,
      pageId: unit.sourceRef?.pageId || null,
      pageTitle: unit.sourceRef?.pageTitle || null,
      titlePath: unit.sourceRef?.titlePath || [],
      heading: unit.heading || null,
      normalizedFile: unit.sourceRef?.normalizedFile || null,
    },
    evidenceText: unit.text,
  };
}

function extractDecimalPrecision(unit) {
  const text = String(unit.text || '');
  const rules = [];
  const patterns = [
    /소수점\s*(?:최대\s*)?(\d+|한|하나|두|둘|세|셋|네|넷|다섯)\s*(?:째\s*)?자리(?:까지|이내|만)?/gi,
    /소수\s*(?:최대\s*)?(\d+|한|하나|두|둘|세|셋|네|넷|다섯)\s*자리(?:까지|이내|만)?/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const maxDecimals = koreanNumber(match[1]);
      if (!Number.isFinite(maxDecimals)) continue;
      rules.push(makeRule(unit, 'input.numeric.decimalPrecision', { maxDecimals }, {
        confidence: 'high',
        suggestedExpansion: {
          success: ['integer', `decimal-${maxDecimals}-digits`],
          failure: [`decimal-${maxDecimals + 1}-digits`, 'non-numeric'],
          boundary: ['zero-decimal', `max-decimal-${maxDecimals}`],
        },
      }));
    }
  }
  return rules;
}

function extractLength(unit) {
  const text = String(unit.text || '');
  const rules = [];
  const rangePatterns = [
    /(\d+)\s*(?:~|-|부터)\s*(\d+)\s*자/g,
    /(\d+)\s*자\s*(?:이상|부터).{0,20}?(\d+)\s*자\s*(?:이하|이내|까지)/g,
    /최소\s*(\d+)\s*자.{0,20}?최대\s*(\d+)\s*자/g,
  ];
  for (const pattern of rangePatterns) {
    for (const match of text.matchAll(pattern)) {
      const minLength = Number(match[1]);
      const maxLength = Number(match[2]);
      if (!Number.isFinite(minLength) || !Number.isFinite(maxLength) || maxLength < minLength) continue;
      rules.push(makeRule(unit, 'input.text.length.range', { minLength, maxLength }, {
        confidence: 'high',
        suggestedExpansion: {
          success: ['at-min', 'inside-range', 'at-max'],
          failure: ['below-min', 'above-max'],
          boundary: ['empty', 'whitespace-only'],
        },
      }));
    }
  }

  for (const match of text.matchAll(/(?:최대\s*)?(\d+)\s*자\s*(?:이내|이하|까지)|최대\s*(\d+)\s*자/g)) {
    const maxLength = Number(match[1] || match[2]);
    if (!Number.isFinite(maxLength)) continue;
    rules.push(makeRule(unit, 'input.text.length.max', { maxLength }, {
      confidence: 'medium',
      suggestedExpansion: {
        success: ['at-max', 'below-max'],
        failure: ['above-max'],
        boundary: ['empty', 'whitespace-only'],
      },
    }));
  }

  for (const match of text.matchAll(/(?:최소\s*)?(\d+)\s*자\s*(?:이상|부터)|최소\s*(\d+)\s*자/g)) {
    const minLength = Number(match[1] || match[2]);
    if (!Number.isFinite(minLength)) continue;
    rules.push(makeRule(unit, 'input.text.length.min', { minLength }, {
      confidence: 'medium',
      suggestedExpansion: {
        success: ['at-min', 'above-min'],
        failure: ['below-min'],
        boundary: ['empty', 'whitespace-only'],
      },
    }));
  }

  return rules;
}

function extractRequired(unit) {
  const text = String(unit.text || '');
  if (/^\|.*\bRequired\b/i.test(text) && !/(필수|미입력|빈\s*값|공백)/i.test(text)) return [];
  const hasKoreanRequired = /(필수|미입력|빈\s*값|공백)/i.test(text);
  const hasEnglishRequired = /\b(required|required field|mandatory)\b/i.test(text) && /\b(input|field|value|empty|blank)\b/i.test(text);
  if (!hasKoreanRequired && !hasEnglishRequired) return [];
  return [makeRule(unit, 'input.value.required', {
    required: true,
    trimBeforeValidate: /(공백|trim|트림)/i.test(text),
  }, {
    confidence: 'medium',
    suggestedExpansion: {
      success: ['valid-non-empty'],
      failure: ['empty', 'whitespace-only'],
    },
  })];
}

function extractNumericType(unit) {
  const text = String(unit.text || '');
  if (!/(숫자만|숫자\s*입력|number|numeric|정수|소수)/i.test(text)) return [];
  return [makeRule(unit, 'input.value.type.numeric', {
    valueType: 'number',
  }, {
    confidence: 'medium',
    suggestedExpansion: {
      success: ['integer', 'decimal'],
      failure: ['korean-text', 'alphabet-text', 'special-character'],
    },
  })];
}

function extractAllowedCharacters(unit) {
  const text = String(unit.text || '');
  const allowed = [];
  if (/한글|국문/.test(text)) allowed.push('korean');
  if (/영문|알파벳|alphabet/i.test(text)) allowed.push('alphabet');
  if (/숫자|number|numeric/i.test(text)) allowed.push('number');
  if (/공백|space/i.test(text)) allowed.push('space');
  if (/하이픈|-/.test(text)) allowed.push('hyphen');
  if (/언더바|underscore|_/.test(text)) allowed.push('underscore');
  if (!allowed.length || !/(허용|가능|입력 가능|allowed)/i.test(text)) return [];
  return [makeRule(unit, 'input.value.allowedCharacters', {
    allowedCharacters: unique(allowed),
  }, {
    confidence: 'medium',
    suggestedExpansion: {
      success: unique(allowed.map((item) => `${item}-sample`)),
      failure: ['unlisted-special-character'],
    },
  })];
}

function dedupeRules(rules) {
  const seen = new Set();
  const output = [];
  for (const rule of rules) {
    const key = JSON.stringify({
      category: rule.category,
      params: rule.params,
      policyUnitId: rule.sourceRef?.policyUnitId,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(rule);
  }
  return output;
}

async function extractPolicyRules(ctx) {
  const policyUnits = ctx.policyUnits || readYaml(ctx.rootDir, ctx.paths.confluencePolicyUnits);
  const units = asArray(policyUnits.units);
  const rules = dedupeRules(units.flatMap((unit) => [
    ...extractDecimalPrecision(unit),
    ...extractLength(unit),
    ...extractRequired(unit),
    ...extractNumericType(unit),
    ...extractAllowedCharacters(unit),
  ]));

  const output = {
    schemaVersion: 1,
    kind: 'policy-rules',
    generatedAt: new Date().toISOString(),
    source: {
      policyUnits: ctx.paths.confluencePolicyUnits,
      extractionOwner: 'js-runner',
      agentResponsibility: 'Agent must verify these extracted rules against normalized Confluence text before applying them to fields.',
    },
    ruleCount: rules.length,
    rules,
  };

  writeYaml(ctx.rootDir, ctx.paths.policyRules, output);
  ctx.policyRules = output;

  return {
    status: 'ok',
    ruleCount: rules.length,
    output: ctx.paths.policyRules,
  };
}

module.exports = { extractPolicyRules };
