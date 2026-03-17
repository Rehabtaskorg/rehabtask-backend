import { prisma } from "../config/prisma.js";
import { NotFoundError } from "../utils/errors.js";

export const getActiveFaqs = async () => {
    const faqs = await prisma.fAQ.findMany({
        where: { isActive: true },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });
    return faqs;
}

export const getAllFaqs = async () => {
    const faqs = await prisma.fAQ.findMany({
        orderBy: [{ category: "asc" }, { sortOrder: "asc" },]
    });
    return faqs;
}

export const createFaq = async (data) => {
    const faq = await prisma.fAQ.create({
        data: {
            question: data.question,
            answer: data.answer,
            category: data.category,
            sortOrder: data.sortOrder ?? 0,
            isActive: data.isActive ?? true,
        },
    });
    return faq;
}

export const updateFaq = async (faqId, data) => {
    const existing = await prisma.fAQ.findUnique({ where: { id: faqId } });
    if (!existing) throw new NotFoundError("FAQ not found");

    const faq = await prisma.fAQ.update({
        where: { id: faqId },
        data
    });
    return faq;
}

export const deleteFaq = async (faqId) => {
    const existing = await prisma.fAQ.findUnique({ where: { id: faqId } });
    if (!existing) throw new NotFoundError("FAQ not found");

    await prisma.fAQ.delete({ where: { id: faqId } });
    return { message: "FAQ deleted successfully" };
};