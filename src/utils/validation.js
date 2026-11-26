const HttpError = require('./http-error');

function requiredText(value, field, maxLength = 500) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', `O campo ${field} é obrigatório.`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(400, 'VALIDATION_ERROR', `O campo ${field} deve ter no máximo ${maxLength} caracteres.`);
  }

  return normalized;
}

function optionalText(value, field, maxLength = 500) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, maxLength);
}

function requiredIsoDate(value, field, { allowFuture = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', `O campo ${field} é obrigatório e deve ser uma data ISO 8601.`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'VALIDATION_ERROR', `O campo ${field} não contém uma data válida.`);
  }

  if (!allowFuture && date.getTime() > Date.now()) {
    throw new HttpError(400, 'VALIDATION_ERROR', `O campo ${field} não pode estar no futuro.`);
  }

  return date.toISOString();
}

function enumValue(value, allowedValues, field) {
  if (!allowedValues.includes(value)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `O campo ${field} deve conter um dos valores: ${allowedValues.join(', ')}.`
    );
  }
  return value;
}

function positiveInteger(value, field, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, 'VALIDATION_ERROR', `O campo ${field} deve ser um número inteiro positivo.`);
  }
  return parsed;
}

module.exports = { requiredText, optionalText, requiredIsoDate, enumValue, positiveInteger };
