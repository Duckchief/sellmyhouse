// src/domains/property/portal.formatter.ts
import type { PortalName } from '@prisma/client';
import type { Agent, Listing, Property } from '@prisma/client';

export interface PortalContent {
  portal: PortalName;
  title: string;
  description: string;
  flatDetails: {
    town: string;
    flatType: string;
    floorAreaSqm: number;
    storeyRange: string;
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

  let photos: string[] = [];
  try {
    photos = JSON.parse(listing.photos as string) as string[];
  } catch {
    photos = [];
  }

  return {
    portal,
    title: listing.title ?? `${property.flatType} HDB Flat for Sale in ${property.town}`,
    description: listing.description ?? '',
    flatDetails: {
      town: property.town,
      flatType: property.flatType,
      floorAreaSqm: property.floorAreaSqm,
      storeyRange: property.storeyRange,
      remainingLease: property.remainingLease ?? null,
      askingPrice: property.askingPrice ? Number(property.askingPrice) : 0,
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
