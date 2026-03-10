import {
    generateBookingsReport,
    generatePaymentsReport,
    generateUserActivityReport,
} from "../services/admin.report.service.js";

const today = () => new Date().toISOString().split("T")[0];

const bookingsReportController = async (req, res, next) => {
    try {
        const { startDate, endDate, status } = req.query;
        const csv = await generateBookingsReport({ startDate, endDate, status });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="bookings-report-${today()}.csv"`);
        res.send(csv);
    } catch (error) {
        next(error);
    }
};

const paymentsReportController = async (req, res, next) => {
    try {
        const { startDate, endDate, status } = req.query;
        const csv = await generatePaymentsReport({ startDate, endDate, status });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="payments-report-${today()}.csv"`);
        res.send(csv);
    } catch (error) {
        next(error);
    }
};

const usersReportController = async (req, res, next) => {
    try {
        const { startDate, endDate, role } = req.query;
        const csv = await generateUserActivityReport({ startDate, endDate, role });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="users-report-${today()}.csv"`);
        res.send(csv);
    } catch (error) {
        next(error);
    }
};

export { bookingsReportController, paymentsReportController, usersReportController };
