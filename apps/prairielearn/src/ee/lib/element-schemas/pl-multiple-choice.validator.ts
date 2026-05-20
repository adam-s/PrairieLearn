import {
  type TagElement,
  type TagValidator,
  attr,
  defineTagValidators,
  validateAttributes,
  validateElement,
} from '@reteps/tree-sitter-htmlmustache/linter';

import { isBooleanValue, isFalseValue } from './htmlmustache-plugin-utils.ts';

const FEEDBACK_REQUIREMENTS: Record<string, string> = {
  'all-of-the-above-feedback': 'all-of-the-above',
  'none-of-the-above-feedback': 'none-of-the-above',
};

function hasLiteralFalseAttribute(element: TagElement, attribute: string): boolean {
  const value = attr(element, attribute).literal();
  return value !== undefined && isFalseValue(value);
}

function literalNumberAttribute(element: TagElement, attribute: string): number | undefined {
  return attr(element, attribute).literalMap((value) =>
    typeof value === 'string' ? Number(value) : undefined,
  );
}

function validateAnswerScoreRange(element: TagElement): boolean {
  const score = literalNumberAttribute(element, 'score');
  if (score === undefined) return false;

  return Number.isNaN(score) || score < 0 || score > 1;
}

export const validators: TagValidator[] = defineTagValidators('pl-multiple-choice', {
  'pl/multiple-choice-requires-answer'(element, context) {
    validateElement(context, element, {
      invalid: (e) =>
        !attr(e, 'external-json').present() && e.childrenWithTag('pl-answer').length === 0,
      message: 'pl-multiple-choice element must have at least 1 answer choice.',
    });
  },

  'pl/multiple-choice-order'(element, context) {
    validateElement(context, element, {
      reportAttribute: 'fixed-order',
      invalid: (e) => attr(e, 'fixed-order').present() && attr(e, 'order').present(),
      message: 'Setting answer choice order should be done with the "order" attribute.',
    });
  },

  'pl/multiple-choice-display'(element, context) {
    validateElement(context, element, {
      reportAttribute: 'inline',
      invalid: (e) => attr(e, 'inline').present() && attr(e, 'display').present(),
      message:
        "Cannot set both 'display' and 'inline' attributes. Use only 'display'; the 'inline' attribute is deprecated.",
    });

    validateAttributes(context, element, ['size', 'placeholder'], {
      invalid: (e, attribute) => {
        if (!attribute.present()) return false;
        const display = attr(e, 'display');
        const displayValue = display.literal();
        return !display.present() || (displayValue !== undefined && displayValue !== 'dropdown');
      },
      message: (_e, attribute) =>
        `pl-multiple-choice: if using ${attribute.name}, you must also set display to "dropdown".`,
    });
  },

  'pl/multiple-choice-aota-nota-feedback'(element, context) {
    validateAttributes(context, element, Object.keys(FEEDBACK_REQUIREMENTS), {
      invalid: (e, feedbackAttribute) => {
        if (!feedbackAttribute.present()) return false;
        const matchingAttributeName = FEEDBACK_REQUIREMENTS[feedbackAttribute.name];
        if (!matchingAttributeName) return false;
        const matchingAttribute = attr(e, matchingAttributeName);
        const matchingValue = matchingAttribute.literal();
        return (
          !matchingAttribute.present() ||
          (matchingValue !== undefined && isFalseValue(matchingValue))
        );
      },
      message: (_e, feedbackAttribute) =>
        `pl-multiple-choice: if using ${feedbackAttribute.name}, you must also use ${FEEDBACK_REQUIREMENTS[feedbackAttribute.name] ?? feedbackAttribute.name}.`,
    });
  },

  'pl/multiple-choice-builtin-grading'(element, context) {
    if (hasLiteralFalseAttribute(element, 'builtin-grading')) {
      validateAttributes(context, element, ['weight', 'hide-score-badge'], {
        invalid: (_e, attribute) => attribute.present(),
        message: (_e, attribute) =>
          `"${attribute.name}" should not be set when builtin-grading is false.`,
      });

      validateAttributes(context, element, ['all-of-the-above', 'none-of-the-above'], {
        invalid: (_e, attribute) => {
          const value = attribute.literal();
          return value !== undefined && !isBooleanValue(value);
        },
        message: (_e, attribute) =>
          `"${attribute.name}" should be set to true or false when builtin-grading is false.`,
      });
    }
  },

  'pl/multiple-choice-builtin-grading-answer'(element, context) {
    if (!hasLiteralFalseAttribute(element, 'builtin-grading')) {
      return;
    }

    for (const child of element.childrenWithTag('pl-answer')) {
      validateAttributes(context, child, ['score', 'feedback'], {
        invalid: (_e, attribute) => attribute.present(),
        message: (_e, attribute) =>
          `"${attribute.name}" on pl-answer should not be set when builtin-grading is false.`,
      });
    }
  },

  'pl/multiple-choice-answer-score-range'(element, context) {
    for (const child of element.childrenWithTag('pl-answer')) {
      validateElement(context, child, {
        reportAttribute: 'score',
        invalid: validateAnswerScoreRange,
        message: 'Score must be a numeric value in the range [0.0, 1.0].',
      });
    }
  },

  'pl/multiple-choice-unique-answer-html': {
    options: { includeInnerHtml: true },
    validate(element, context) {
      const seen = new Set<string>();
      for (const child of element.childrenWithTag('pl-answer')) {
        const normalized = (child.innerHtml ?? '').trim();
        if (seen.has(normalized)) {
          context.reportElement(child, `duplicate child inner HTML "${normalized}"`);
          continue;
        }
        seen.add(normalized);
      }
    },
  },
});
