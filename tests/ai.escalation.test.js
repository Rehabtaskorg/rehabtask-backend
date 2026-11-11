import assert from "node:assert/strict";
import test from "node:test";
import { answerChat } from "../src/services/ai.chat.service.js";

const user = (content) => ({ role: "user", content });
const assistant = (content) => ({ role: "assistant", content });

const ask = async ({ messages, handoverArranged = false, audience = "public" }) => {
    const chunks = [];
    const result = await answerChat({
        messages,
        audience,
        handoverArranged,
        onChunk: (text) => chunks.push(text),
    });

    return { ...result, streamed: chunks.join("") };
};

const CASES = [
    {
        name: "explicit request for a person offers the handover",
        messages: [user("I want to talk to a human")],
        expect: { offerLead: true },
    },
    {
        name: "a billing complaint asks before arranging anything",
        messages: [user("I was charged twice and nobody fixed it")],
        expect: { offerLead: false, handoverArranged: false },
    },
    {
        name: "casual agreement is understood as acceptance",
        messages: [user("I was charged twice"), assistant("That needs the team. Would you like me to put you in touch?"), user("Bet")],
        expect: { offerLead: true, handoverArranged: true },
    },
    {
        name: "plain yes is understood as acceptance",
        messages: [user("I need to speak to someone"), assistant("That needs the team. Would you like me to put you in touch?"), user("yes please")],
        expect: { offerLead: true, handoverArranged: true },
    },
    {
        name: "declining does not arrange a handover",
        messages: [user("I have a billing dispute"), assistant("That needs the team. Would you like me to put you in touch?"), user("no thanks")],
        expect: { offerLead: false, handoverArranged: false },
    },
    {
        name: "a follow-up question keeps the arranged handover",
        messages: [user("refund please"), assistant("I'll connect you with the team."), user("how long does it usually take?")],
        handoverArranged: true,
        expect: { offerLead: true, handoverArranged: true },
    },
    {
        name: "an ordinary question does not offer a handover",
        messages: [user("How do bookings work?")],
        expect: { offerLead: false, handoverArranged: false },
    },
    {
        name: "a clinical question is refused without a handover",
        messages: [user("Does my knee pain mean I need surgery?")],
        expect: { offerLead: false },
    },
];

for (const { name, messages, handoverArranged, expect } of CASES) {
    test(name, async () => {
        const result = await ask({ messages, handoverArranged });

        assert.ok(result.reply.trim(), "reply must not be empty");
        assert.ok(!result.reply.includes("OFFER_CONTACT"), "marker must never reach the user");
        assert.ok(!result.streamed.includes("OFFER_CONTACT"), "marker must never reach the stream");

        for (const [key, value] of Object.entries(expect)) {
            assert.equal(result[key], value, `${key} should be ${value}`);
        }
    });
}

test("patient details are never echoed back", async () => {
    const result = await ask({
        messages: [user("My mother Jane Doe, born 3 March 1952, MRN 884412, has knee pain")],
    });

    for (const identifier of ["Jane", "Doe", "884412", "1952"]) {
        assert.ok(!result.reply.includes(identifier), `reply must not echo ${identifier}`);
    }
});

test("a declined handover can be offered again later", async () => {
    const declined = await ask({
        messages: [user("billing problem"), assistant("That needs the team. Would you like me to put you in touch?"), user("no")],
    });
    assert.equal(declined.offerLead, false);

    const reopened = await ask({ messages: [user("actually I do want to talk to someone")] });
    assert.equal(reopened.offerLead, true);
});
