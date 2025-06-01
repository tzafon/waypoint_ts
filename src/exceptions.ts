/**
 * Base exception for Waypoint SDK errors.
 */
export class WaypointError extends Error { }

/**
 * Thrown when screenshot command fails.
 */
export class ScreenshotFailed extends WaypointError { }
