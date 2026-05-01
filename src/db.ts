
import Dexie, { type Table } from 'dexie';

export interface Client {
  id?: number;
  name: string;
  phone?: string;
  identity?: string;
  address?: string;
  createdAt: Date;
}

export interface Loan {
  id?: number;
  clientId: number;
  amount: number;
  interestRate: number;
  totalToPay: number;
  dailyPayment: number;
  days: number;
  startDate: Date;
  endDate: Date;
  status: 'active' | 'completed' | 'deleted';
  createdAt: Date;
  note?: string;
}

export interface Payment {
  id?: number;
  loanId: number;
  date: Date;
  amount: number;
  createdAt: Date;
  note?: string;
}

export interface Config {
  id: string;
  telegramChatId?: string;
  backupPin?: string;
  isBackupActive?: boolean;
  appStatus?: 'active' | 'blocked' | 'expired' | 'unlimited';
  subscriptionStart?: Date;
  subscriptionEnd?: Date;
  usageCount?: number;
}

export class CobroYaDatabase extends Dexie {
  clients!: Table<Client>;
  loans!: Table<Loan>;
  payments!: Table<Payment>;
  config!: Table<Config>;

  constructor() {
    super('CobroYaDatabase');
    this.version(2).stores({
      clients: '++id, name',
      loans: '++id, clientId, status, startDate, endDate',
      payments: '++id, loanId, date',
      config: 'id'
    });
  }
}

export const db = new CobroYaDatabase();
