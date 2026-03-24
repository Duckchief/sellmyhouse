import { ValidationError } from '../../errors';

export interface ListingDescriptionPropertyFields {
  flatType: string;
  town: string;
  block: string;
  street: string;
  floorAreaSqm: number;
  storey: string; // maps to Property.level
  leaseCommencementDate: number;
}

export function buildListingDescriptionPrompt(
  template: string,
  property: ListingDescriptionPropertyFields,
): string {
  if (!template || !template.trim()) {
    throw new ValidationError(
      'Listing description prompt is not configured — update it in Settings',
    );
  }

  return template
    .replace(/{flatType}/g, property.flatType)
    .replace(/{town}/g, property.town)
    .replace(/{block}/g, property.block)
    .replace(/{street}/g, property.street)
    .replace(/{floorAreaSqm}/g, String(property.floorAreaSqm))
    .replace(/{storey}/g, property.storey)
    .replace(/{leaseCommencementDate}/g, String(property.leaseCommencementDate));
}
