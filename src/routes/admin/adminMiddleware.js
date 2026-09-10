import { USER_ROLES } from "../../utils/constants.js";
import { authenticate, authorize } from "../../middleware/auth.js";

export const adminOrSubAdmin = [authenticate, authorize([USER_ROLES.ADMIN, USER_ROLES.SUB_ADMIN])];
export const adminOnly = [authenticate, authorize([USER_ROLES.ADMIN])];
