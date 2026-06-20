/**
 * Legal text for the Compliance Forms onboarding step (Independent Contractor
 * Agreement, HIPAA Acknowledgment). The Independent Contractor Agreement text
 * is the real document provided by stakeholders, with its [MONTH] [DAY] [YEAR]
 * and [CLINICIAN] placeholders converted to merge tokens. Clause 12(b)'s blank
 * address lines (meant for the Clinician to hand-fill on paper) are merged
 * with the therapist's actual address already collected in onboarding Step 1,
 * rather than left as a vague "on file" reference.
 *
 * The HIPAA Acknowledgment is still placeholder content — stakeholders have
 * not yet delivered final legal copy for it.
 *
 * Kept in this file rather than the DB so swapping in an admin-editable
 * source later only requires changing these two functions' bodies, not
 * every call site.
 */

const INDEPENDENT_CONTRACTOR_AGREEMENT_RAW = `Contract/Employment Agreement

This Contract/Employment Agreement ("Agreement"), is entered on {{CONTRACT_DATE}}, between Steadfast Rehabilitation Services, LLC, a IL company (the "Company"), and {{CLINICIAN_NAME}} (the "Clinician").

The Company desires to employ the Employee, and the Employee wishes to enter into that employment, as set forth in this agreement.

The agree as follows:

EMPLOYMENT.

(a) Position. The Company hereby employs the Contractor in the position of Therapist and the Contractor hereby accepts this employment as of the effective date. During her employment with the Company, the Employee shall devote his/her best to the business of the Company.

(b) Duties. The Contractor shall perform duties that are customarily associated with his/her then-current title, consistent with the operating agreement of the Company and as required by the Company's Chief Executive Officer.

(c) Company Policies. The employment relationship between the parties will also be governed by the general employment policies and practices of the Company. If any terms of this agreement differ from or conflict with the Company's general employment policies or practices, this agreement will control.

(d) At-Will Status. THE EMPLOYEE ACKNOWLEDGES THAT EMPLOYMENT WITH THE COMPANY IS FOR AN UNSPECIFIED DURATION AND CONSTITUTES "AT-WILL" EMPLOYMENT. THE EMPLOYEE FURTHER ACKNOWLEDGES THAT THIS EMPLOYMENT RELATIONSHIP MAY BE TERMINATED AT ANY TIME, WITH OR WITHOUT GOOD CAUSE OR FOR ANY OR NO CAUSE, AT THE OPTION OF EITHER THE COMPANY OR THE EMPLOYEE, WITH OR WITHOUT NOTICE.

Term of Agreement

1. The term of this Agreement (the "Term") will begin on the date this Agreement is entered into and will remain in full force and effect for one (1) year, subject to earlier termination as provided in this Agreement. The Term of this Agreement may be extended by mutual written agreement of the Parties.

2. In the event either Party wishes to terminate this Agreement, the terminating Party will be required to provide the other Party with written notice fourteen (14) days prior to the effective date of termination.

Compensation

3. Company shall pay Contractor for said Services on a per visit basis and will be paid weekly.

4. Company shall be under no obligation to provide Contractor with benefits of any kind.

Confidentiality

5. Confidential information (the "Confidential Information") shall refer to any data or information relating to the business of Company and Company's clients (the "Clients") that reasonably would be considered to be proprietary to Company and Clients, including, but not limited to, accounting records, business processes, marketing materials, training manuals, pricing information, financial information, business development plans, projections, internal performance statistics, client records, patient records, and other competitively sensitive information, which is not generally known in the industry of Company or its Clients and where the release of said Confidential Information reasonably could be expected to cause harm to Company or its Clients.

6. Contractor agrees that he/she will not disclose or use, for any purpose, any Confidential Information employee obtains, except as authorized by Company. This obligation will survive indefinitely upon termination of this Agreement.

Non-Competition

7. Other than with the express written consent of Company, Contractor will not, during the Term of this Agreement, or within one (1) year after the termination of this Agreement, divert, or attempt to divert, from Company any business Company has enjoyed, solicited, or attempted to solicit, from other individuals or corporations, prior to termination of this Agreement.

8. Other than with the express written consent of Company, Contractor will not, during the Term of this Agreement, or within one (1) year after the termination of this Agreement, provide services directly, or indirectly, as an employee or independent contractor, to individuals or entities that are Clients of Company prior to termination of this Agreement.

Non-Solicitation

9. Contractor acknowledges that any attempt on the part of Contractor to interfere with Company's relationship with its employees or other independent contractors (service provider), such as inducing an employee to leave Company's employ, would be harmful and damaging to Company.

10. Contractor agrees that, during the Term of this Agreement, and for a period of one (1) year after the termination of this Agreement, Contractor will not, in any way, directly, or indirectly:
    a. Induce, or attempt to induce, any employee or (service provider) of Company to terminate his/her/its employment or retainer/business relationship with Company;
    b. interfere with or disrupt, Company's relationship with its employees or other independent contractors (service providers);
    c. Discuss employment opportunities, or provide information about competitive employment, to any of Company's employees or other independent contractors (service providers);
    d. Solicit, entice, or hire any or (service provider) of Company.

Return of Property

11. Upon termination of this Agreement, Contractor will return to Company any property, documentation, records or confidential information, which is the property of Company or Company's Clients.

Notice

12. All notices, requests, demands or other communications required or permitted by the terms of this Agreement will be given in writing and delivered to the Parties of this Agreement as follows:
    a. Steadfast Rehabilitation Services, LLC, 332 S Michigan Ave STE 121 #5888, Chicago, IL 60604
    b. {{CLINICIAN_NAME}}, {{CLINICIAN_ADDRESS}}

or to such other address as any Party may inform the other to be his/her/its current address.

Dispute Resolution

13. In the event a dispute arises out of, or in connection with, this Agreement, the Parties will attempt to resolve the dispute through friendly consultation.

14. If the dispute is not resolved within a reasonable amount of time, not to exceed thirty (30) days, then any outstanding issues will be submitted to mediation in accordance with any statutory rules of mediation. If mediation is unavailable, or the dispute is not resolved through mediation, any outstanding issues will be submitted to final and binding arbitration in accordance with the laws of the State of Illinois. The arbitrator's award will be final and judgment may be entered upon it by any court having jurisdiction within the State of Illinois.

Governing Law

15. This Agreement shall be construed in accordance with and governed, to the exclusion of the law of any other forum, by the laws of the State of Illinois, without regard to the jurisdiction in which any action or special proceeding may be instituted.

Modification of Agreement

16. Any amendment or modification of this Agreement, or additional obligation assumed by either Party in connection with this Agreement, will only be binding if evidenced in writing and signed by each Party or an authorized representative of each Party.

Time is of the Essence

17. Time is of the essence of this Agreement. No extension or variation of this Agreement will operate as a waiver of this provision.

Assignment

18. Contractor will not voluntarily, or by operation of law, assign or otherwise transfer its obligations under this Agreement without the prior written consent of Company.

Entire Agreement

19. This Agreement constitutes the entire agreement of the Parties, and the Parties agree there is no representation, warranty, collateral agreement or condition affecting this Agreement, except as is expressly provided in this Agreement.

Titles/Headings

20. Headings have been inserted for the convenience of the Parties only and are not to be considered when interpreting this Agreement.

Severability

21. In the event any provisions of this Agreement are held to be invalid or unenforceable, in whole or in part, all other provisions will continue to be valid and enforceable, with the invalid or unenforceable parts severed from the remainder of this Agreement.

Waiver

22. The waiver by either Party of a breach, default, delay or omission of any provision of this Agreement by the other Party will not be construed as a waiver of any subsequent breach of the same or other provisions.

IN WITNESS WHEREOF, the Parties hereto have executed this Agreement as of the day and year first above written.

Steadfast Rehabilitation Services, LLC — countersigned by an authorized representative of the Company (handled offline, outside this application).`;

const HIPAA_ACKNOWLEDGMENT_TEXT = `HIPAA Acknowledgment

[PLACEHOLDER — final legal text pending from stakeholders.]

As a condition of providing services through RehabTask, you may have access to Protected Health Information ("PHI") belonging to patients you treat. This acknowledgment confirms your understanding of, and commitment to, your obligations under the Health Insurance Portability and Accountability Act (HIPAA).

You agree to:
- Access PHI only as necessary to perform your duties as a therapist on the platform.
- Never disclose PHI to any third party without proper authorization.
- Store, transmit, and dispose of any PHI in your possession securely, in accordance with HIPAA's Privacy and Security Rules.
- Report any suspected breach or unauthorized disclosure of PHI to RehabTask immediately upon discovery.
- Complete any HIPAA training required by RehabTask from time to time.

Violation of these obligations may result in removal from the RehabTask platform and may carry independent legal consequences under federal and state law.

By signing below, you acknowledge that you have read, understood, and agree to comply with the obligations described above.`;

/**
 * Replace {{CLINICIAN_NAME}}, {{CONTRACT_DATE}}, and {{CLINICIAN_ADDRESS}}
 * tokens with the therapist's actual details, server-side, before the
 * agreement is ever shown to or signed by the therapist.
 * @param {{ fullName: string, addressLine1: string, addressLine2: string|null, city: string, state: string, zipCode: string }} therapist
 * @returns {string} the rendered agreement text
 */
export const renderIndependentContractorAgreement = (therapist) => {
    const contractDate = new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    const addressParts = [
        therapist.addressLine1,
        therapist.addressLine2,
        [therapist.city, therapist.state].filter(Boolean).join(", "),
        therapist.zipCode,
    ].filter(Boolean);
    const clinicianAddress = addressParts.length ? addressParts.join(", ") : "Address on file with the Company";

    return INDEPENDENT_CONTRACTOR_AGREEMENT_RAW
        .replaceAll("{{CLINICIAN_NAME}}", therapist.fullName)
        .replaceAll("{{CONTRACT_DATE}}", contractDate)
        .replaceAll("{{CLINICIAN_ADDRESS}}", clinicianAddress);
};

/**
 * @returns {string} the HIPAA Acknowledgment text — placeholder pending real legal copy.
 */
export const getHipaaAcknowledgmentText = () => HIPAA_ACKNOWLEDGMENT_TEXT;