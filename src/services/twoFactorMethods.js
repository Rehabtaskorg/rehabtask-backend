/** Honor a saved preference, with SMS as the default for new enrollments. */
export const resolvePreferredMethod = (methods, settings = null, requested = null) => {
    if (requested && methods[requested]) return requested;
    if (settings?.preferredMethod && methods[settings.preferredMethod]) return settings.preferredMethod;
    if (methods.sms) return "sms";
    if (methods.email) return "email";
    return null;
};
