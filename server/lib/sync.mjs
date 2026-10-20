export const fourHourDelay = (hours = 4) => Math.max(1, Number(hours)) * 60 * 60 * 1000
export const nextScheduledAt = (from = new Date(), hours = 4) => new Date(new Date(from).getTime() + fourHourDelay(hours)).toISOString()
export const retryDelay = (failures, hours = 4) => Math.min(fourHourDelay(hours), [60_000, 300_000, 900_000, 3_600_000][Math.min(Math.max(0, failures - 1), 3)])
