export type ResourceType = 'lecture' | 'solution' | 'pyq' | 'assignment' | 'tutorial' | 'other';

export interface ScannedResource {
  semester: number;
  courseId?: string;
  courseName?: string;
  type: ResourceType;
  title: string;
  provider: 'google_drive';
  driveFileId: string;
  sourceUrl: string;
  sourcePage: string;
  sectionId?: string;
  surroundingHeading?: string;
}

export interface WebsiteResource {
  semester: number;
  courseId: string;
  courseName: string;
  type: ResourceType;
  title: string;
  provider: 'google_drive';
  driveFileId: string;
  sourceUrl: string;
  originFile: string;
}

export interface ScanReport {
  filesScanned: number;
  anchorsScanned: number;
  driveLinks: number;
  duplicateIds: number;
  resources: WebsiteResource[];
  unresolved: ScannedResource[];
}

export interface RawScanReport {
  filesScanned: number;
  anchorsScanned: number;
  driveLinks: number;
  duplicateIds: number;
  resources: ScannedResource[];
}

export interface CourseAlias { id: string; name: string; semester?: number; aliases?: string[] }
