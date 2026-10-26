export function isAllowedEmployeeEmail(email: unknown) { return typeof email === "string" && email.toLowerCase().endsWith("@tossdown.com"); }
