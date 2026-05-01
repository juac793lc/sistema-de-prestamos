
import { differenceInDays, isSameDay, startOfDay } from 'date-fns';
import { type Loan, type Payment } from '../db';

export function calculateLoanTotals(amount: number, interestRate: number, days: number) {
  const totalToPay = amount + (amount * interestRate / 100);
  const dailyPayment = totalToPay / days;
  return { totalToPay, dailyPayment };
}

export function getInstallmentsInfo(loan: Loan, payments: Payment[]) {
  const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0);
  // Calculamos cuántas cuotas completas se han cubierto con el dinero entregado
  const installmentsPaid = Math.floor(totalPaid / loan.dailyPayment);
  return {
    totalPaid,
    installmentsPaid,
    percentage: Math.min(100, (totalPaid / loan.totalToPay) * 100)
  };
}

export function getLoanStatus(loan: Loan, payments: Payment[]) {
  const today = startOfDay(new Date());
  const { totalPaid } = getInstallmentsInfo(loan, payments);
  
  if (totalPaid >= loan.totalToPay) return 'completed';

  const daysSinceStart = differenceInDays(today, startOfDay(loan.startDate));
  const expectedPayments = Math.max(0, Math.min(loan.days, daysSinceStart + 1));
  const expectedPaidAmount = expectedPayments * loan.dailyPayment;

  if (today > startOfDay(loan.endDate) && totalPaid < loan.totalToPay) return 'expired';

  const diff = expectedPaidAmount - totalPaid;
  
  // Si debe más de 3 cuotas diarias, se pone amarillo. Más de 6, rojo.
  if (diff <= loan.dailyPayment * 3) return 'green';
  if (diff <= loan.dailyPayment * 6) return 'yellow';
  return 'red';
}

export function hasPaidToday(loanId: number, payments: Payment[]) {
  const today = startOfDay(new Date());
  return payments.some(p => p.loanId === loanId && isSameDay(startOfDay(p.date), today));
}
