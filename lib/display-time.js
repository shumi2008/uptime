const DISPLAY_TZ = process.env.DISPLAY_TZ || "America/New_York";

function formatDisplayDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TZ,
  });
}

module.exports = {
  DISPLAY_TZ,
  formatDisplayDateTime,
};
