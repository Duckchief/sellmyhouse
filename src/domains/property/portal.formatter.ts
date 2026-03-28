// src/domains/property/portal.formatter.ts
import type { PortalName } from '@prisma/client';
import type { Agent, Listing, Property } from '@prisma/client';
import { ValidationError } from '@/domains/shared/errors';

export interface PortalContent {
  portal: PortalName;
  title: string;
  description: string;
  flatDetails: {
    town: string;
    flatType: string;
    floorAreaSqm: number;
    unitAddress: string;
    remainingLease: string | null;
    askingPrice: number;
    block: string;
    street: string;
  };
  photos: string[];
  ceaDetails: {
    agentName: string;
    ceaRegNo: string;
    agencyName: string; // from SystemSetting 'agency_name' — passed in by caller
    agencyLicence: string; // from SystemSetting 'agency_licence' — passed in by caller
    agentPhone: string;
  };
}

export interface PortalFormatterInput {
  portal: PortalName;
  listing: Listing;
  property: Property;
  agent: Pick<Agent, 'id' | 'name' | 'ceaRegNo' | 'phone'>;
  agencyName: string;
  agencyLicence: string;
}

/**
 * Pure function — no DB access, no async.
 * Transforms listing + property + agent data into portal-ready structured content.
 * CEA fields are always present and populated (compliance requirement).
 * agencyName and agencyLicence are passed in from SystemSetting by the caller.
 */
export function formatForPortal(input: PortalFormatterInput): PortalContent {
  const { portal, listing, property, agent, agencyName, agencyLicence } = input;

  if (!property.askingPrice || Number(property.askingPrice) <= 0) {
    throw new ValidationError('Asking price must be set before generating portal content');
  }

  // M47: Handle both string[] (legacy) and PhotoRecord[] (current) formats
  let photos: string[] = [];
  try {
    const parsed = JSON.parse(listing.photos as string) as Array<
      string | { path?: string; optimizedPath?: string }
    >;
    photos = parsed
      .map((p) => {
        if (typeof p === 'string') return p;
        return p.optimizedPath || p.path || '';
      })
      .filter(Boolean);
  } catch {
    photos = [];
  }

  if (photos.length === 0) {
    throw new ValidationError('At least one photo is required before generating portal content');
  }

  return {
    portal,
    title: listing.title ?? `${property.flatType} HDB Flat for Sale in ${property.town}`,
    description: listing.description ?? '',
    flatDetails: {
      town: property.town,
      flatType: property.flatType,
      floorAreaSqm: property.floorAreaSqm,
      unitAddress: `#${property.level}-${property.unitNumber}`,
      remainingLease: property.remainingLease ?? null,
      askingPrice: Number(property.askingPrice),
      block: property.block,
      street: property.street,
    },
    photos,
    ceaDetails: {
      agentName: agent.name,
      ceaRegNo: agent.ceaRegNo,
      agencyName,
      agencyLicence,
      agentPhone: agent.phone,
    },
  };
}
