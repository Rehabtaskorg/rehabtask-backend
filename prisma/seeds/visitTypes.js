/**
 * Visit type seed data — clinical session types grouped by discipline.
 */
export const VISIT_TYPES = [
    // Physical Therapy
    { code: "PTE", name: "Physical Therapist Evaluation", discipline: "Physical Therapist", sortOrder: 1 },
    { code: "PTF", name: "Physical Therapist Follow-up", discipline: "Physical Therapist", sortOrder: 2 },
    { code: "PTFA", name: "Physical Therapist Assistant Follow-up", discipline: "Physical Therapist", sortOrder: 3 },
    { code: "PTSU", name: "Physical Therapist Supervisory Visit", discipline: "Physical Therapist", sortOrder: 4 },
    { code: "PTDC", name: "Physical Therapist Discharge", discipline: "Physical Therapist", sortOrder: 5 },
    { code: "PTAV", name: "Physical Therapist Attempted Visit", discipline: "Physical Therapist", sortOrder: 6 },

    // Occupational Therapy
    { code: "OTE", name: "Occupational Therapist Evaluation", discipline: "Occupational Therapist", sortOrder: 1 },
    { code: "OTF", name: "Occupational Therapist Follow-up", discipline: "Occupational Therapist", sortOrder: 2 },
    { code: "OTFA", name: "Occupational Therapist Assistant Follow-up", discipline: "Occupational Therapist", sortOrder: 3 },
    { code: "OTSU", name: "Occupational Therapist Supervisory Visit", discipline: "Occupational Therapist", sortOrder: 4 },
    { code: "OTDC", name: "Occupational Therapist Discharge", discipline: "Occupational Therapist", sortOrder: 5 },
    { code: "OTAV", name: "Occupational Therapist Attempted Visit", discipline: "Occupational Therapist", sortOrder: 6 },

    // Speech Therapy
    { code: "STE", name: "Speech Therapist Evaluation", discipline: "Speech Therapist", sortOrder: 1 },
    { code: "STF", name: "Speech Therapist Follow-up", discipline: "Speech Therapist", sortOrder: 2 },
    { code: "STAV", name: "Speech Therapist Attempted Visit", discipline: "Speech Therapist", sortOrder: 3 },

    // Shared across disciplines
    { code: "MV", name: "Missed Visit", discipline: "All", sortOrder: 99 },
];