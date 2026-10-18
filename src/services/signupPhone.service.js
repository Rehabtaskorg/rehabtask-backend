import { prisma } from "../config/prisma.js";
import { sendSms } from "./sms.service.js";
import { createSignupPhoneService } from "./signupPhone.core.js";

export const signupPhone = createSignupPhoneService({ prisma, sendSms });
