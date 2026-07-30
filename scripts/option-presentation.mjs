function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalLabel(rawValue) {
  return typeof rawValue === "string" ? rawValue : rawValue?.label;
}

export function optionPresentationErrors(option) {
  const presentation = option?.presentation;
  if (presentation == null) return [];
  const errors = [];
  if (!isObject(presentation)) return ["presentation must be an object"];

  for (const field of ["label", "controlLabel", "defaultSystem"]) {
    if (!isNonEmpty(presentation[field])) errors.push(`presentation.${field} is required`);
  }
  if (presentation.propertyLabel != null && !isNonEmpty(presentation.propertyLabel)) {
    errors.push("presentation.propertyLabel must be non-empty text");
  }
  if (presentation.help != null && !isNonEmpty(presentation.help)) {
    errors.push("presentation.help must be non-empty text");
  }

  const systems = Array.isArray(presentation.systems) ? presentation.systems : [];
  if (systems.length < 2) errors.push("presentation.systems needs at least two systems");
  const systemIds = new Set();
  for (const [index, system] of systems.entries()) {
    if (!isObject(system)) {
      errors.push(`presentation.systems[${index}] must be an object`);
      continue;
    }
    if (!isNonEmpty(system.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(system.id)) {
      errors.push(`presentation.systems[${index}].id must be a safe lowercase slug`);
    } else if (systemIds.has(system.id)) {
      errors.push(`presentation repeats system ${system.id}`);
    } else {
      systemIds.add(system.id);
    }
    if (!isNonEmpty(system.label)) errors.push(`presentation.systems[${index}].label is required`);
    if (system.approximate != null && typeof system.approximate !== "boolean") {
      errors.push(`presentation.systems[${index}].approximate must be a boolean`);
    }
  }
  if (isNonEmpty(presentation.defaultSystem) && !systemIds.has(presentation.defaultSystem)) {
    errors.push(`presentation.defaultSystem ${presentation.defaultSystem} is not declared`);
  }

  const labelsBySystem = new Map([...systemIds].map((id) => [id, new Set()]));
  for (const [index, rawValue] of (option.values || []).entries()) {
    const canonical = canonicalLabel(rawValue);
    if (!isObject(rawValue)) {
      errors.push(`value ${canonical || index + 1} must be an object with displayLabels when presentation is enabled`);
      continue;
    }
    if (!isObject(rawValue.displayLabels)) {
      errors.push(`value ${canonical || index + 1} needs displayLabels`);
      continue;
    }
    for (const id of systemIds) {
      const label = rawValue.displayLabels[id];
      if (!isNonEmpty(label)) {
        errors.push(`value ${canonical || index + 1} is missing display label ${id}`);
        continue;
      }
      if (labelsBySystem.get(id).has(label)) {
        errors.push(`system ${id} repeats display label ${label}`);
      }
      labelsBySystem.get(id).add(label);
    }
    for (const id of Object.keys(rawValue.displayLabels)) {
      if (!systemIds.has(id)) errors.push(`value ${canonical || index + 1} contains undeclared display label ${id}`);
    }
    if (rawValue.displayNote != null && !isNonEmpty(rawValue.displayNote)) {
      errors.push(`value ${canonical || index + 1} has an empty displayNote`);
    }
  }
  return errors;
}

export function optionPresentationConfig(option, optionIndex) {
  if (option?.presentation == null) return null;
  const presentation = option.presentation;
  return {
    optionIndex,
    optionName: option.name,
    label: presentation.label,
    controlLabel: presentation.controlLabel,
    defaultSystem: presentation.defaultSystem,
    propertyLabel: presentation.propertyLabel || `${presentation.label} reference`,
    help: presentation.help || "",
    systems: presentation.systems.map((system) => ({
      id: system.id,
      label: system.label,
      approximate: system.approximate === true,
    })),
    values: option.values.map((rawValue) => ({
      canonical: canonicalLabel(rawValue),
      labels: { ...rawValue.displayLabels },
      note: rawValue.displayNote || "",
    })),
  };
}

export function productOptionPresentations(product) {
  return (product.options || [])
    .map((option, optionIndex) => optionPresentationConfig(option, optionIndex))
    .filter(Boolean);
}
