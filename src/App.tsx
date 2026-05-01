/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
  Plus, 
  Users, 
  Wallet, 
  History, 
  Home, 
  CheckCircle, 
  UserPlus, 
  Search,
  Phone,
  Trash2,
  Calendar,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  AlertCircle,
  Clock,
  HelpCircle,
  Download,
  Upload,
  ArrowRight,
  X,
  MapPin,
  User,
  Eye,
  EyeOff,
  LogOut,
  Calculator,
  Send,
  Shield,
  Lock,
  PieChart,
  BarChart3,
  RefreshCw,
  UserCheck
} from 'lucide-react';

import { motion, AnimatePresence } from 'motion/react';
import { format, startOfDay, addDays, isToday, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';

import { db, type Client, type Loan, type Payment } from './db';
import { calculateLoanTotals, getLoanStatus, hasPaidToday, getInstallmentsInfo } from './utils/loanUtils';
import { cn } from './lib/utils';

// --- Components ---

type Tab = 'home' | 'paid' | 'clients' | 'loans' | 'history';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxyiindigcnIx6q3bd2lqnr929x3CjlaU72867vKQpRFyRqAj9FGuMbiSJSefsqp3dL/exec';

function getValidDate(d: any): Date {
  if (!d) return new Date(0);
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function safeIsToday(d: any): boolean {
  if (!d) return false;
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return false;
  return isToday(parsed);
}

function safeFormatTime(d: any): string {
  if (!d) return '---';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return '---';
  return format(parsed, "HH:mm", { locale: es });
}

function safeFormatDate(d: any, formatStr: string = 'dd MMMM yyyy'): string {
  if (!d) return '---';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return '---';
  return format(parsed, formatStr, { locale: es });
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddLoan, setShowAddLoan] = useState(false);
  const [selectedLoanForPayment, setSelectedLoanForPayment] = useState<Loan | null>(null);

  const [loanToDelete, setLoanToDelete] = useState<number | null>(null);
  const [clientToDelete, setClientToDelete] = useState<number | null>(null);

  // Database Queries
  const clients = useLiveQuery(() => db.clients.toArray()) || [];
  const activeLoans = useLiveQuery(() => db.loans.where('status').equals('active').toArray()) || [];
  const allLoans = useLiveQuery(() => db.loans.toArray()) || [];
  const allPayments = useLiveQuery(() => db.payments.toArray()) || [];

  const handleReceivePayment = async (loanId: number, amount: number, note?: string) => {
    const loan = activeLoans.find(l => l.id === loanId);
    if (!loan) return;

    await db.payments.add({
      loanId: loan.id!,
      date: new Date(),
      amount: amount,
      createdAt: new Date(),
      note: note
    });
    
    // Check if completed
    const paymentsForLoan = allPayments.filter(p => p.loanId === loan.id);
    const totalPaidBefore = paymentsForLoan.reduce((acc, p) => acc + p.amount, 0);
    const newTotalPaid = totalPaidBefore + amount;

    if (newTotalPaid >= loan.totalToPay) {
      // Si el pago es una renovación (o termina el préstamo), lo marcamos
      if (note === 'DESCUENTO') {
        // En caso de que se haya clicado el botón especial
      }

      // CLEANUP: If loan is fully paid, delete the loan and its payments
      setTimeout(async () => {
        await db.transaction('rw', db.loans, db.payments, async () => {
          // Si queremos conservar el historial de pagos para la renovación, 
          // quizás no deberíamos borrarlos aún? 
          // El plan dice: "Detectar la Renovación al Crear el Nuevo Préstamo"
          // "Filtramos todos los pagos de HOY que tengan la nota 'DESCUENTO'"
          // Si los borramos aquí, AddLoanModal no los encontrará.
          
          // CAMBIO ESTRATÉGICO: Marcamos como completado y dejamos los pagos hoy.
          // El cleanup real de pagos viejos debería ocurrir quizás al día siguiente o después de la renovación.
          await db.loans.update(loan.id!, { status: 'completed' });
          // NO borramos pagos aquí para que la renovación pueda detectarlos.
        });
        showAlert('PRÉSTAMO FINALIZADO', `¡El préstamo de ${clients.find(c => c.id === loan.clientId)?.name} ha sido pagado en su totalidad!`);
      }, 1000);
    }
    
    setSelectedLoanForPayment(null);
  };

  const settings = useLiveQuery(() => db.config.get('settings'));
  const [userName, setUserName] = useState('');
  const [backupPin, setBackupPin] = useState('');
  const [isBackupActive, setIsBackupActive] = useState(false);
  const [appStatus, setAppStatus] = useState<string>('active');
  const [subscriptionEnd, setSubscriptionEnd] = useState<Date | null>(null);

  useEffect(() => {
    if (settings) {
      setUserName(settings.telegramChatId || '');
      setBackupPin(settings.backupPin || '');
      setIsBackupActive(!!settings.isBackupActive);
      
      // Limpiar y normalizar el estado del servidor (activo, vencido, ilimitado)
      const rawStatus = (settings.appStatus || 'active').toString().toLowerCase().trim();
      setAppStatus(rawStatus);
      
      setSubscriptionEnd(null);
    }
  }, [settings]);

  const [isSyncing, setIsSyncing] = useState(false);
  
  // States for Admin System
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminUser, setAdminUser] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [adminTeam, setAdminTeam] = useState<{name: string, pin: string}[]>([]);
  const [adminData, setAdminData] = useState<any[]>([]);
  const [isAdminSyncing, setIsAdminSyncing] = useState(false);

  useEffect(() => {
    const savedAdmin = localStorage.getItem('cobroya_admin_session');
    // Using a separate async IIFE so we don't return a Promise from useEffect
    if (savedAdmin) {
      const { user, pin, team } = JSON.parse(savedAdmin);
      const normalizedTeam = (team || []).map((t: any) => typeof t === 'string' ? { name: t, pin: '' } : t);
      setAdminUser(user);
      setAdminPin(pin);
      setAdminTeam(normalizedTeam);
      setIsAdminMode(true);
      
      // Fetch initial data for dashboard upon successful reload
      setTimeout(() => {
        loadAdminData(user, pin, normalizedTeam);
      }, 0);
    }
  }, []);

  const handleAdminLogin = async (user: string, pin: string, isRegister = false): Promise<boolean> => {
    setIsAdminSyncing(true);
    try {
      let response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'admin_login',
          admin_user: user,
          admin_pin: pin
        })
      });
      let data = await response.json();
      
      // Si el acceso jefe falla, intentamos crearlo automáticamente (auto-registro)
      if (data.status !== 'ok') {
        const regResponse = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'admin_register',
            admin_user: user,
            admin_pin: pin
          })
        });
        const regData = await regResponse.json();
        
        if (regData.status === 'ok') {
           showAlert('ÉXITO', 'Cuenta de Administrador nueva creada. Entrando...');
           // Una vez registrado, simulamos un login exitoso con team vacío
           data = { status: 'ok', team: [] };
        } else {
           showAlert('ADMIN', regData.message || 'Error al crear Admin o la clave es incorrecta');
           return false;
        }
      }

      const rawTeam = data.team || [];
      const normalizedTeam = rawTeam.map((t: any) => typeof t === 'string' ? { name: t, pin: '' } : t);
      setAdminUser(user);
      setAdminPin(pin);
      setAdminTeam(normalizedTeam);
      setIsAdminMode(true);
      localStorage.setItem('cobroya_admin_session', JSON.stringify({
        user,
        pin,
        team: normalizedTeam
      }));
      // Al entrar exitosamente, cargamos los datos de una vez
      loadAdminData(user, pin, normalizedTeam);
      return true;

    } catch (e) {
      showAlert('ERROR', 'Fallo conexión con servidor admin');
      return false;
    } finally {
      setIsAdminSyncing(false);
    }
  };

  const loadAdminData = async (user = adminUser, pin = adminPin, currentTeam = adminTeam) => {
    if (!user || !pin || currentTeam.length === 0) return [];
    setIsAdminSyncing(true);
    try {
      // Iterate through the local team and fetch data for each worker using recovering
      const allWorkerData: any[] = [];
      const fetchPromises = currentTeam.map(async (worker) => {
        try {
          const n = worker.name.trim().toLowerCase();
          const p = worker.pin.trim();
          const url = `${APPS_SCRIPT_URL}?action=recuperar&nombre=${encodeURIComponent(n)}&clave=${encodeURIComponent(p)}`;
          const verifyRes = await fetch(url);
          const verifyData = await verifyRes.json();
          if (verifyData.status === 'ok' && verifyData.datos) {
            allWorkerData.push({
              worker: worker.name.toUpperCase(),
              datos: verifyData.datos,
              lastSync: new Date().toISOString()
            });
          }
        } catch (err) {
          console.warn('Error fetching worker data:', worker.name, err);
        }
      });
      await Promise.all(fetchPromises);
      setAdminData(allWorkerData);
      return allWorkerData;
    } catch (e) {
      console.error("❌ Admin data fetch failed:", e);
      return [];
    } finally {
      setIsAdminSyncing(false);
    }
  };

  const handleUpdateTeam = async (newTeam: {name: string, pin: string}[], checkWorkerName?: string): Promise<boolean> => {
    setIsAdminSyncing(true);
    try {
      let fetchedWorkerData: any = null;

      // 1. VERIFICACIÓN: Solo vincula si el colaborador existe
      if (checkWorkerName) {
        const worker = newTeam.find(w => w.name.toUpperCase() === checkWorkerName.toUpperCase());
        if (worker) {
          const n = worker.name.trim().toLowerCase();
          const p = worker.pin.trim();
          const verifyUrl = `${APPS_SCRIPT_URL}?action=recuperar&nombre=${encodeURIComponent(n)}&clave=${encodeURIComponent(p)}`;
          
          const verifyRes = await fetch(verifyUrl);
          const verifyData = await verifyRes.json();

          if (verifyData.status !== 'ok') {
            showAlert('¡ATENCIÓN!', `❌ NO EXISTE. El colaborador "${worker.name.toUpperCase()}" o la clave no coinciden.`);
            setIsAdminSyncing(false);
            return false;
          }

          if (verifyData.datos) {
            fetchedWorkerData = {
              worker: worker.name.toUpperCase(),
              datos: verifyData.datos,
              lastSync: new Date().toISOString()
            };
          }
        }
      }

      // 2. GUARDAR CONFIGURACIÓN Y ACTUALIZAR
      // Guardamos en LocalStorage porque sabemos que ya existe el colaborador.
      setAdminTeam(newTeam);
      localStorage.setItem('cobroya_admin_session', JSON.stringify({
        user: adminUser,
        pin: adminPin,
        team: newTeam
      }));
      
      // Opcional: intentamos guardar la lista en el servidor si admin_update_team existe
      try {
        await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'admin_update_team',
            admin_user: adminUser,
            admin_pin: adminPin,
            team: newTeam.map(w => ({ name: w.name.trim(), pin: w.pin.trim() }))
          })
        });
      } catch (err) {
        console.warn('Servidor no guardó team, operando en local.', err);
      }
      
      // 3. AGREGAR LOS DATOS A LA LISTA DEL ADMIN
      if (fetchedWorkerData) {
        setAdminData(prev => {
          const alreadyIn = prev.some((d: any) => (d.worker || "").toString().toUpperCase() === fetchedWorkerData.worker.toUpperCase());
          if (alreadyIn) return prev;
          return [...prev, fetchedWorkerData];
        });
        if (checkWorkerName) {
          showAlert('VINCULACIÓN EXACTA', `✅ Datos de "${checkWorkerName.toUpperCase()}" traídos exitosamente.`);
        }
      }
      return true;
    } catch (e) {
      showAlert('ERROR DE RED', '❌ Revisa tu conexión. No se pudo preguntar al servidor.');
      return false;
    } finally {
      setIsAdminSyncing(false);
    }
  };

  const handleAdminLogout = () => {
    localStorage.removeItem('cobroya_admin_session');
    setIsAdminMode(false);
    setAdminUser('');
    setAdminPin('');
    setAdminTeam([]);
    setAdminData([]);
  };

  // Custom Modal States
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'confirm' | 'alert';
    onConfirm?: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'alert'
  });

  const showAlert = (title: string, message: string) => {
    setModalConfig({ isOpen: true, title, message, type: 'alert' });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModalConfig({ isOpen: true, title, message, type: 'confirm', onConfirm });
  };
  
  const saveSettings = async (user: string, pin: string, isRegister = false) => {
    const normalizedUser = user.trim(); 
    const normalizedPin = pin.trim();
    
    if (!normalizedUser || !normalizedPin) {
      showAlert('DATOS INCOMPLETOS', '⚠️ Debes ingresar un nombre y una clave para poder vincular.');
      return;
    }
    
    setIsSyncing(true);
    try {
      const newState = { 
        id: 'settings', 
        telegramChatId: normalizedUser, 
        backupPin: normalizedPin, 
        isBackupActive: true
      };
      
      // Si el equipo está limpio, creamos el usuario localmente sin enviarlo a la base aún
      if (clients.length === 0) {
        await db.config.put(newState);
        setUserName(normalizedUser);
        setBackupPin(normalizedPin);
        setIsBackupActive(true);
        // NO enviamos nada a la nube todavía, simplemente lo dejamos entrar.
        showAlert("REGISTRO EXITOSO", "✅ Se ha iniciado sesión.");
        setIsSyncing(false);
      } else {
        // Dispositivo ya tiene datos (clientes). Entonces sí puede registrar/vincular en la nube.
        await db.config.put(newState);
        setUserName(normalizedUser);
        setBackupPin(normalizedPin);
        setIsBackupActive(true);
        // Aquí sí enviamos a la nube porque ya hay datos.
        await handleCloudSave(false, normalizedUser, normalizedPin);
        showAlert("INGRESO EXITOSO", "✅ Se cambió el usuario y se subió el respaldo.");
        setIsSyncing(false);
      }

    } catch (err) {
      console.error("Linking error:", err);
      showAlert("ERROR", "❌ Ocurrió un error al intentar vincular. Revisa tu conexión.");
      setIsSyncing(false);
    }
  };

  const handleCloudSave = async (isAutomatic = false, overrideUser?: string, overridePin?: string) => {
    const finalUser = (overrideUser || userName || "").trim();
    const finalPin = (overridePin || backupPin || "").trim();

    if (!finalUser || !finalPin) return;
    
    // En modo manual siempre enviamos para confirmar vinculación
    // En modo automático solo si hay algo útil que guardar
    if (isAutomatic && clients.length === 0 && allLoans.length === 0) return;
    
    // Si ya estamos sincronizando manualmente, no hacer nada (prevenir dobles llamadas)
    if (!isAutomatic && isSyncing) return;
    
    if (!isAutomatic) setIsSyncing(true);
    
    try {
      const dbData = {
        clients: await db.clients.toArray(),
        loans: await db.loans.toArray(),
        payments: await db.payments.toArray(),
        appStatus: appStatus, // Enviar el estado actual (activo, vencido, ilimitado)
        usageCount: 1
      };

      const payload = {
        action: 'guardar',
        nombre: finalUser,
        clave: finalPin,
        datos: dbData
      };

      // Timeout for fetch (8 seconds)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        
        const result = await response.json();
        clearTimeout(timeoutId);

        if (result && result.status_app) {
          const newStatus = result.status_app.toString().toLowerCase().trim();
          if (newStatus !== appStatus) {
            console.log("🔄 Cambio de estado detectado:", newStatus);
            setAppStatus(newStatus);
            // Actualizar en DB local para persistencia inmediata
            await db.config.update('settings', { appStatus: newStatus });
          }
        }
      } catch (e) {
        console.error("☁️ Sync failed or timed out:", e);
      }

      if (!isAutomatic) {
        // En modo manual, damos un aviso positivo asumiendo que se envió
        setIsBackupActive(true);
        const currentSettings = await db.config.get('settings') || { id: 'settings' };
        await db.config.put({ ...currentSettings, telegramChatId: finalUser, backupPin: finalPin, isBackupActive: true });
        
        setUserName(finalUser);
        setBackupPin(finalPin);
        
        showAlert('VINCULACIÓN OK', '✅ ¡DISPOSITIVO VINCULADO! Sus datos se están sincronizando con la nube de forma segura.');
      }
    } catch (err) {
      console.error('☁️ Save error:', err);
      if (!isAutomatic) showAlert('ERROR DE NUBE', '❌ No se pudo conectar con el servidor de respaldo. Revisa tu conexión a internet.');
    } finally {
      if (!isAutomatic) setIsSyncing(false);
    }
  };

  // Sincronización automática ante cualquier cambio
  useEffect(() => {
    if (!isBackupActive || !userName || !backupPin || clients.length === 0) return;
    
    // Auto-activación de suscripción si hay uso real
    const checkAutoActivate = async () => {
      if (appStatus !== 'active') return;
      
      const res = await db.payments.toArray();
      const loans = await db.loans.toArray();
      
      // Mínimo 4 clientes
      if (clients.length >= 4) {
        const clientPaymentsCount = new Map<number, number>();
        res.forEach(p => {
          clientPaymentsCount.set(p.loanId, (clientPaymentsCount.get(p.loanId) || 0) + 1);
        });
        
        // Al menos 2 clientes con 3 pagos cada uno
        let qualifiedClients = 0;
        loans.forEach(l => {
          if ((clientPaymentsCount.get(l.id!) || 0) >= 3) qualifiedClients++;
        });
        
        if (qualifiedClients >= 2) {
          console.log("🚀 ACTIVACIÓN AUTOMÁTICA POR USO REAL");
          // Aquí podríamos cambiar el estado a 'unlimited' o lo que el servidor decida
          // Por ahora solo lo registramos en el próximo save
        }
      }
    };
    
    checkAutoActivate();

    const timer = setTimeout(() => {
      handleCloudSave(true);
    }, 10000); // 10 segundos después del último cambio (según sugerencia 1.3)

    return () => clearTimeout(timer);
  }, [clients.length, allLoans.length, allPayments.length, userName, backupPin, isBackupActive, appStatus]);

  /**
   * handleCloudRestore: Main function to download and restore data from the cloud.
   * Following Local-First architecture:
   * 1. Connects to Google Apps Script.
   * 2. Requests backup file associated with Username and PIN.
   * 3. Downloads JSON data.
   * 4. Cleans local IndexedDB tables (clients, loans, payments).
   * 5. Replaces with downloaded data (bulkPut) and transforms dates.
   * 6. Forces app reload to apply changes.
   */
  const recuperarDatos = async (overrideUser?: string, overridePin?: string, isSilentOnNotFound = false): Promise<boolean> => {
    const name = (overrideUser || userName || "").trim();
    const pin = (overridePin || backupPin || "").trim();

    if (!name || !pin) {
      if (!isSilentOnNotFound) showAlert("DATOS FALTANTES", "⚠️ Ingresa Usuario y Clave para recuperar.");
      return false;
    }

    if (!isSilentOnNotFound) setIsSyncing(true);
    
    try {
      const url = `${APPS_SCRIPT_URL}?action=recuperar&nombre=${encodeURIComponent(name)}&clave=${encodeURIComponent(pin)}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(url, { signal: controller.signal });
      const data = await res.json();
      clearTimeout(timeoutId);
      
      if (data.status === 'ok') {
        const backup = data.datos || { clients: [], loans: [], payments: [] };
        
        const toDate = (d: any) => {
          if (!d) return new Date();
          const parsed = new Date(d);
          return isNaN(parsed.getTime()) ? new Date() : parsed;
        };

        await db.transaction('rw', db.clients, db.loans, db.payments, db.config, async () => {
          await db.clients.clear();
          await db.loans.clear();
          await db.payments.clear();

          if (backup.clients) await db.clients.bulkAdd(backup.clients.map((c: any) => ({ ...c, createdAt: toDate(c.createdAt) })));
          if (backup.loans) await db.loans.bulkAdd(backup.loans.map((l: any) => ({ ...l, startDate: toDate(l.startDate), endDate: toDate(l.endDate), createdAt: toDate(l.createdAt) })));
          if (backup.payments) await db.payments.bulkAdd(backup.payments.map((p: any) => ({ ...p, date: toDate(p.date), createdAt: toDate(p.createdAt) })));
          
          const rawServerStatus = (data.status_app || 'active').toString().toLowerCase().trim();
          
          await db.config.put({
            id: 'settings',
            telegramChatId: name,
            backupPin: pin,
            isBackupActive: true,
            appStatus: rawServerStatus
          });
        });

        if (!isSilentOnNotFound) showAlert("ÉXITO", "✅ ¡VINCULACIÓN CORRECTA! Datos descargados.");
        setTimeout(() => window.location.reload(), 1500);
        return true;
      } else {
        // Si el estado no es ok, entonces nombre o senha no coinciden
        return false;
      }
    } catch (err: any) {
      console.error("❌ FALLO:", err);
      if (!isSilentOnNotFound) showAlert("ERROR DE RED", "❌ No se pudo conectar con el servidor.");
      return false;
    } finally {
      if (!isSilentOnNotFound) setIsSyncing(false);
    }
  };


  const handleDeleteClient = async (id: number) => {
    const loans = await db.loans.where('clientId').equals(id).toArray();
    const loanIds = loans.map(l => l.id!);
    
    await db.transaction('rw', db.clients, db.loans, db.payments, async () => {
      await db.clients.delete(id);
      await db.loans.where('clientId').equals(id).delete();
      if (loanIds.length > 0) {
        await db.payments.where('loanId').anyOf(loanIds).delete();
      }
    });
    setClientToDelete(null);
  };

  const handleLogout = async () => {
    showConfirm(
      '¿CERRAR SESIÓN TOTAL?', 
      'Se borrarán TODOS los datos de este móvil y tendrás que volver a vincularte. ¿Estás seguro?',
      async () => {
        await db.transaction('rw', db.clients, db.loans, db.payments, db.config, async () => {
          await db.clients.clear();
          await db.loans.clear();
          await db.payments.clear();
          await db.config.delete('settings');
        });
        console.log("👋 SESIÓN CERRADA");
        window.location.reload();
      }
    );
  };

  const handleDeleteLoan = async (id: number) => {
    await db.transaction('rw', db.loans, db.payments, async () => {
      await db.loans.delete(id);
      await db.payments.where('loanId').equals(id).delete();
    });
    setLoanToDelete(null);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'home': return (
        <HomeScreen 
          loans={activeLoans} 
          payments={allPayments} 
          clients={clients} 
          onOpenPayment={(loan) => setSelectedLoanForPayment(loan)} 
        />
      );
      case 'paid': return <PaidTodayScreen loans={allLoans} payments={allPayments} clients={clients} />;
      case 'clients': return <ClientsScreen clients={clients} onDeleteRequest={(id) => setClientToDelete(id)} />;
      case 'loans': return <LoansScreen loans={activeLoans} clients={clients} payments={allPayments} onDeleteRequest={(id) => setLoanToDelete(id)} />;
      case 'history': return (
        <HistoryScreen 
          allPayments={allPayments} 
          clients={clients} 
          loans={allLoans} 
          activeLoansCount={activeLoans.length} 
          userName={userName}
          backupPin={backupPin}
          isBackupActive={isBackupActive}
          onSaveSettings={saveSettings}
          onCloudSave={handleCloudSave}
          onCloudRestore={recuperarDatos}
          isSyncing={isSyncing}
          onLogout={handleLogout}
        />
      );
      default: return null;
    }
  };

  if (appStatus === 'blocked' || appStatus === 'expired' || appStatus === 'vencido' || appStatus === 'bloqueado') {
    const displayType = (appStatus === 'expired' || appStatus === 'vencido') ? 'expired' : 'blocked';
    return <BlockedScreen userName={userName} backupPin={backupPin} type={displayType} />;
  }

  if (isAdminMode) {
    return (
      <AdminDashboard 
        adminUser={adminUser}
        team={adminTeam}
        teamData={adminData}
        isSyncing={isAdminSyncing}
        onRefresh={() => loadAdminData()}
        onLogout={handleAdminLogout}
        onUpdateTeam={handleUpdateTeam}
        showAlert={showAlert}
      />
    );
  }

  if (!isBackupActive) {
    return <LoginScreen onLogin={saveSettings} onAdminLogin={handleAdminLogin} isSyncing={isSyncing} isAdminSyncing={isAdminSyncing} />;
  }

  return (
    <div className="flex flex-col h-screen bg-slate-100 text-slate-950 overflow-hidden font-sans relative">
      {/* Header */}
      <header className="bg-white px-5 py-4 border-b-2 border-slate-200 flex justify-between items-center z-10 shrink-0">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tighter">Cobroya</h1>
          <p className="text-[9px] text-slate-500 font-extrabold uppercase tracking-widest">{format(new Date(), "eeee d 'de' MMMM", { locale: es })}</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowAddClient(true)}
            className="p-2.5 bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-100 active:scale-90 transition-transform"
          >
            <UserPlus size={18} />
          </button>
          <button 
            onClick={() => setShowAddLoan(true)}
            className="p-2.5 bg-green-600 text-white rounded-xl shadow-lg shadow-green-100 active:scale-90 transition-transform"
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-24 pt-4 px-4 bg-[#F8FAFC]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-slate-200 px-2 py-3 flex justify-around items-center shadow-[0_-4px_20px_rgba(0,0,0,0.05)] z-20">
        <NavButton active={activeTab === 'home'} icon={<Home size={22} strokeWidth={2.5} />} label="Cobros" onClick={() => setActiveTab('home')} />
        <NavButton active={activeTab === 'paid'} icon={<CheckCircle size={22} strokeWidth={2.5} />} label="Listos" onClick={() => setActiveTab('paid')} />
        <NavButton active={activeTab === 'clients'} icon={<Users size={22} strokeWidth={2.5} />} label="Clientes" onClick={() => setActiveTab('clients')} />
        <NavButton active={activeTab === 'loans'} icon={<Wallet size={22} strokeWidth={2.5} />} label="Activos" onClick={() => setActiveTab('loans')} />
        <NavButton active={activeTab === 'history'} icon={<History size={22} strokeWidth={2.5} />} label="Control" onClick={() => setActiveTab('history')} />
      </nav>

      {/* Modals */}
      <AddClientModal isOpen={showAddClient} onClose={() => setShowAddClient(false)} />
      <AddLoanModal 
        isOpen={showAddLoan} 
        onClose={() => setShowAddLoan(false)} 
        clients={clients} 
        activeLoans={activeLoans} 
        allPayments={allPayments}
        allLoans={allLoans}
      />
      <PaymentModal 
        loan={selectedLoanForPayment} 
        client={selectedLoanForPayment ? clients.find(c => c.id === selectedLoanForPayment.clientId) : undefined}
        onClose={() => setSelectedLoanForPayment(null)} 
        onConfirm={handleReceivePayment}
        payments={allPayments}
      />
      <ConfirmModal 
        isOpen={clientToDelete !== null} 
        title="¿Eliminar Cliente?" 
        message="Se borrarán permanentemente sus préstamos y todo el historial de pagos."
        onConfirm={() => clientToDelete && handleDeleteClient(clientToDelete)}
        onCancel={() => setClientToDelete(null)}
      />
      <ConfirmModal 
        isOpen={loanToDelete !== null} 
        title="¿Eliminar Préstamo?" 
        message="Se perderá el registro de este préstamo y sus pagos cobrados."
        onConfirm={() => loanToDelete && handleDeleteLoan(loanToDelete)}
        onCancel={() => setLoanToDelete(null)}
      />
      <CustomModal 
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        type={modalConfig.type}
        onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
        onConfirm={modalConfig.onConfirm}
      />
    </div>
  );
}

// --- Navigation ---

function CustomModal({ 
  isOpen, 
  title, 
  message, 
  type, 
  onClose, 
  onConfirm 
}: { 
  isOpen: boolean, 
  title: string, 
  message: string, 
  type: 'confirm' | 'alert', 
  onClose: () => void, 
  onConfirm?: () => void 
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-[40px] w-full max-w-sm overflow-hidden shadow-2xl border-2 border-slate-100"
      >
        <div className="p-8 text-center">
          <div className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-6 shadow-inner ${
            type === 'confirm' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'
          }`}>
            {type === 'confirm' ? <HelpCircle size={32} /> : <CheckCircle size={32} />}
          </div>
          
          <h3 className="text-xl font-black text-slate-900 mb-2 uppercase tracking-tight">{title}</h3>
          <p className="text-slate-500 font-bold text-sm leading-relaxed">{message}</p>
        </div>

        <div className="p-4 bg-slate-50 flex gap-3">
          {type === 'confirm' ? (
            <>
              <button 
                onClick={onClose}
                className="flex-1 p-5 rounded-3xl font-black text-xs text-slate-500 hover:bg-slate-200 transition-all uppercase tracking-widest"
              >
                Cancelar
              </button>
              <button 
                onClick={() => {
                  onConfirm?.();
                  onClose();
                }}
                className="flex-1 p-5 rounded-3xl font-black text-xs bg-slate-950 text-white shadow-lg active:scale-95 transition-all uppercase tracking-widest"
              >
                Confirmar
              </button>
            </>
          ) : (
            <button 
              onClick={onClose}
              className="flex-1 p-5 rounded-3xl font-black text-xs bg-blue-600 text-white shadow-lg active:scale-95 transition-all uppercase tracking-widest"
            >
              Entendido
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function AdminDashboard({ 
  adminUser, 
  team, 
  teamData, 
  isSyncing, 
  onRefresh, 
  onLogout, 
  onUpdateTeam,
  showAlert
}: { 
  adminUser: string, 
  team: {name: string, pin: string}[], 
  teamData: any[], 
  isSyncing: boolean, 
  onRefresh: () => void, 
  onLogout: () => void,
  onUpdateTeam: (team: {name: string, pin: string}[], checkName?: string) => Promise<boolean>,
  showAlert: (title: string, message: string) => void
}) {
  const [selectedWorkerName, setSelectedWorkerName] = useState<string | null>(null);
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [localIsSyncing, setLocalIsSyncing] = useState(false);
  const [filterType, setFilterType] = useState<'todos' | 'hoy' | 'cobrar' | 'atrasados' | 'vencidos'>('todos');
  const [workerToDelete, setWorkerToDelete] = useState<{name: string, pin: string} | null>(null);

  const isLoading = isSyncing || localIsSyncing;

  const selectedWorkerData = useMemo(() => {
    if (!selectedWorkerName || !teamData || !Array.isArray(teamData)) return null;
    return teamData.find(d => {
      const wName = (d.worker || d.user || d.name || d.nombre || "").toString().trim().toUpperCase();
      return wName === selectedWorkerName.toUpperCase();
    });
  }, [selectedWorkerName, teamData]);

  // Resumen Global
  const globalSummary = useMemo(() => {
    let totalCollectedToday = 0;
    let totalLentToday = 0;
    let totalPending = 0;
    let totalClients = 0;

    if (Array.isArray(teamData)) {
      teamData.forEach(w => {
        const d = w.datos || {};
        const payments = d.payments || [];
        const loans = d.loans || [];
        
        payments.forEach((p: any) => {
          try {
            if (safeIsToday(p.date)) totalCollectedToday += Number(p.amount || 0);
          } catch(e) {}
        });

        loans.forEach((l: any) => {
          try {
            if (safeIsToday(l.createdAt || l.date)) totalLentToday += Number(l.totalToPay || l.amount || 0);
            if (l.status === 'active') {
              const paid = (payments as any[]).filter(p => p.loanId == l.id).reduce((acc, p) => acc + Number(p.amount || 0), 0);
              totalPending += (Number(l.totalToPay || l.amount || 0) - paid);
            }
          } catch(e) {}
        });
        
        totalClients += (d.clients || []).length;
      });
    }

    return { totalCollectedToday, totalLentToday, totalPending, totalClients };
  }, [teamData]);

  const filteredData = useMemo(() => {
    if (!selectedWorkerName || !selectedWorkerData) return [];
    
    const d = selectedWorkerData.datos || {};
    const workerClients = d.clients || [];
    const workerLoans = d.loans || [];
    const workerPayments = d.payments || [];

    // Helper to find client by ID or phone
    const findClient = (id: any) => {
      return workerClients.find((c: any) => (c.id == id) || (c.phone == id) || (c.telefono == id));
    };

    if (filterType === 'todos') {
      return workerClients.map((c: any) => ({ type: 'client', client: c }));
    }

    if (filterType === 'hoy') {
      const activity: any[] = [];
      // Prestamos de hoy
      workerLoans.forEach((l: any) => {
        if (safeIsToday(l.createdAt || l.date)) {
          const client = findClient(l.clientId || l.clientPhone);
          activity.push({ type: 'loan_today', loan: l, client });
        }
      });
      // Pagos de hoy
      workerPayments.forEach((p: any) => {
        if (safeIsToday(p.date)) {
          const loan = workerLoans.find((l: any) => l.id == p.loanId);
          const client = findClient(loan?.clientId || p.clientPhone);
          activity.push({ type: 'payment_today', payment: p, loan, client });
        }
      });
      return activity.sort((a, b) => {
        const dateA = getValidDate(a.loan?.createdAt || a.payment?.date).getTime();
        const dateB = getValidDate(b.loan?.createdAt || b.payment?.date).getTime();
        return dateB - dateA;
      });
    }

    // Atrasados o Vencidos (sobre prestamos activos)
    return workerLoans.filter((l: any) => l.status === 'active').map((loan: any) => {
      const client = findClient(loan.clientId || loan.clientPhone);
      const loanPayments = workerPayments.filter((p: any) => p.loanId == loan.id);
      const paid = loanPayments.reduce((acc: any, p: any) => acc + Number(p.amount || 0), 0);
      const totalToPay = Number(loan.totalToPay || loan.amount || 0);
      const remaining = totalToPay - paid;
      
      const lastPayment = loanPayments.sort((a: any, b: any) => getValidDate(b.date).getTime() - getValidDate(a.date).getTime())[0];
      const isPaidToday = lastPayment && safeIsToday(lastPayment.date);

      const days = Number(loan.installments || loan.days || 30);
      const dailyPayment = Number(loan.dailyPayment || 0);
      const startDate = getValidDate(loan.startDate || loan.date || loan.createdAt);
      const endDate = getValidDate(loan.endDate);
      const today = new Date();
      today.setHours(0,0,0,0);
      
      const startDateStart = new Date(startDate);
      startDateStart.setHours(0,0,0,0);
      
      const diffTime = today.getTime() - startDateStart.getTime();
      const daysSinceStart = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
      
      const expectedPayments = Math.max(0, Math.min(days, daysSinceStart + 1));
      const expectedPaidAmount = expectedPayments * dailyPayment;
      const debtDiff = expectedPaidAmount - paid;

      const isExpired = remaining > 0 && today > endDate;
      // Atrasado: Si debe más de 3 cuotas diarias (igual que en la app del cobrador)
      const isDelayed = remaining > 0 && debtDiff > (dailyPayment * 3) && !isExpired;
      
      return { type: 'loan_status', loan, client, paid, remaining, isDelayed, isExpired, isPaidToday };
    }).filter(item => {
      if (filterType === 'vencidos') return item.isExpired;
      if (filterType === 'atrasados') return item.isDelayed;
      if (filterType === 'cobrar') return !item.isPaidToday && item.remaining > 0;
      return true;
    });
  }, [selectedWorkerName, selectedWorkerData, filterType]);

  return (
    <div className="flex flex-col h-screen bg-[#F1F5F9] text-slate-900 overflow-hidden font-sans relative">
      <header className="bg-slate-950 px-6 py-5 flex justify-between items-center z-10 shrink-0 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-900/20">
            <Shield size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white tracking-tight leading-none">Jefe de Cobro</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Admin: {adminUser}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={onRefresh}
            disabled={isLoading}
            className="p-3 bg-white/5 text-white rounded-xl hover:bg-white/10 transition-colors"
          >
            <RefreshCw size={20} className={isLoading ? "animate-spin" : ""} />
          </button>
          <button 
            onClick={onLogout}
            className="p-3 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20 transition-colors"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-6 pb-20">
        {!selectedWorkerName ? (
          <>
            {/* Resumen Compacto */}
            <div className="bg-slate-950 p-6 rounded-[32px] shadow-2xl text-white relative overflow-hidden">
               <div className="absolute top-[-10%] right-[-10%] w-32 h-32 bg-blue-600/20 blur-[60px] rounded-full pointer-events-none"></div>
               <div className="relative z-10">
                 <div className="flex justify-between items-end mb-6">
                   <div>
                     <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Cobradores Activos</p>
                     <p className="text-3xl font-black">{team.length}</p>
                   </div>
                   <div className="text-right">
                     <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Recaudo Hoy</p>
                     <p className="text-3xl font-black text-green-400">${globalSummary.totalCollectedToday.toLocaleString()}</p>
                   </div>
                 </div>
                 
                 <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-6">
                   <div>
                     <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-1">Inversión Hoy</p>
                     <p className="text-lg font-black text-blue-400">${globalSummary.totalLentToday.toLocaleString()}</p>
                   </div>
                   <div className="text-right">
                     <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-1">Cartera Total</p>
                     <p className="text-lg font-black">${globalSummary.totalPending.toLocaleString()}</p>
                   </div>
                 </div>
               </div>
            </div>

            <div className="space-y-3">
               <div className="flex justify-between items-center px-1">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Mi Equipo</h3>
                <button 
                  onClick={() => setShowAddWorker(true)}
                  className="bg-slate-950 text-white p-2 px-4 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center gap-2 active:scale-95 transition-all shadow-lg"
                >
                  <UserPlus size={12} /> Vincular
                </button>
              </div>
              
              {team.length === 0 ? (
                <div className="bg-white rounded-[32px] p-10 text-center border-2 border-dashed border-slate-200">
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Sin cobradores vinculados</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {team.map(worker => {
                    const data = teamData.find(d => {
                      const wName = (d.worker || d.user || d.name || d.nombre || "").toString().toLowerCase();
                      return wName === worker.name.toLowerCase();
                    });
                    const lastSyncStr = safeFormatTime(data?.lastSync);
                    const collectedHoy = data ? (data.datos?.payments || [])
                      .filter((p: any) => safeIsToday(p.date))
                      .reduce((acc: any, p: any) => acc + Number(p.amount), 0) : 0;

                    return (
                      <motion.div 
                        key={worker.name}
                        className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm flex justify-between items-center active:scale-[0.98] transition-all cursor-pointer group hover:border-blue-200"
                      >
                         <div className="flex items-center gap-4 flex-1" onClick={() => setSelectedWorkerName(worker.name)}>
                          <div className={cn(
                            "w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg uppercase",
                            data ? "bg-slate-900 text-white shadow-md shadow-slate-900/10" : "bg-slate-100 text-slate-300"
                          )}>
                            {worker.name[0]}
                          </div>
                          <div>
                            <h4 className="font-black text-slate-900 text-base tracking-tight uppercase leading-none">{worker.name}</h4>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className={cn("w-1.5 h-1.5 rounded-full", data ? "bg-green-500" : "bg-slate-300")}></span>
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Sinc: {lastSyncStr}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right" onClick={() => setSelectedWorkerName(worker.name)}>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Recaudo</p>
                            <p className={cn("text-base font-black", collectedHoy > 0 ? "text-green-600" : "text-slate-300")}>
                               ${collectedHoy.toLocaleString()}
                            </p>
                          </div>
                          <button 
                            disabled={isLoading}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setWorkerToDelete(worker);
                            }}
                            className="bg-slate-100 p-3 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-20 flex items-center justify-center border border-transparent hover:border-red-200 z-20"
                            title="Eliminar del equipo"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-5">
            <button 
              onClick={() => setSelectedWorkerName(null)}
              className="px-5 py-3 bg-white rounded-2xl text-[10px] font-black text-slate-500 uppercase tracking-widest shadow-sm flex items-center gap-2 active:scale-95 transition-all border border-slate-200"
            >
              <ArrowRight size={12} className="rotate-180" /> Volver al Equipo
            </button>
            
             <div className="bg-slate-950 p-8 rounded-[40px] text-white shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-red-600/10 blur-[50px] rounded-full pointer-events-none"></div>
               <div className="flex justify-between items-start mb-6">
                 <div>
                   <h2 className="text-3xl font-black tracking-tight uppercase leading-none">{selectedWorkerName}</h2>
                   <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mt-2 flex items-center gap-1">
                     <Clock size={10} /> {selectedWorkerData ? safeFormatTime(selectedWorkerData.lastSync) : 'Nunca sincronizado'}
                   </p>
                 </div>
                 <div className="bg-red-600 p-3 rounded-2xl shadow-lg shadow-red-900/40">
                   <UserCheck size={20} className="text-white" />
                 </div>
               </div>
               
               <div className="grid grid-cols-2 gap-6 pt-6 border-t border-white/10">
                 <div>
                   <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Recaudo Hoy</p>
                   <p className="text-2xl font-black text-green-400">
                     ${selectedWorkerData ? (selectedWorkerData.datos?.payments || [])
                       .filter((p: any) => safeIsToday(p.date))
                       .reduce((acc: any, p: any) => acc + Number(p.amount), 0)
                       .toLocaleString() : '0'}
                   </p>
                 </div>
                 <div className="text-right">
                   <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Cartera</p>
                   <p className="text-2xl font-black text-white">
                     ${selectedWorkerData ? (selectedWorkerData.datos?.loans || [])
                       .filter((l: any) => l.status === 'active')
                       .reduce((acc: any, l: any) => {
                         const paid = (selectedWorkerData.datos?.payments || []).filter((p: any) => p.loanId === l.id).reduce((a: any, p: any) => a + Number(p.amount), 0);
                         return acc + (Number(l.totalToPay) - paid);
                       }, 0).toLocaleString() : '0'}
                   </p>
                 </div>
               </div>
            </div>

            <div className="flex overflow-x-auto bg-slate-200 p-1 rounded-2xl gap-1 shrink-0 hide-scrollbar">
              {(['hoy', 'cobrar', 'atrasados', 'vencidos', 'todos'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilterType(f)}
                  className={cn(
                    "flex-none px-4 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all",
                    filterType === f ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
                  )}
                >
                  {f === 'hoy' ? 'Hoy' : f === 'cobrar' ? 'Cobrar' : f === 'atrasados' ? 'Atrasados' : f === 'vencidos' ? 'Vencidos' : 'Clientes'}
                </button>
              ))}
            </div>

            <div className="space-y-px">
              {!selectedWorkerData ? (
                 <div className="py-20 text-center bg-white rounded-[40px] border-2 border-dashed border-slate-200 shadow-inner">
                    <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-4 border border-slate-100">
                      <RefreshCw size={32} className="text-slate-200 animate-pulse" />
                    </div>
                    <p className="text-slate-900 font-black uppercase text-[11px] tracking-tight">Sin Datos Disponibles</p>
                    <p className="text-slate-400 font-bold text-[9px] uppercase tracking-widest mt-2 max-w-[200px] mx-auto leading-relaxed">
                      El colaborador debe sincronizar su app al menos una vez para ver sus movimientos aquí.
                    </p>
                 </div>
              ) : filteredData.length === 0 ? (
                 <div className="py-16 text-center bg-white rounded-[32px] border-2 border-dashed border-slate-100">
                  <Users size={32} className="mx-auto text-slate-100 mb-3" />
                  <p className="text-slate-300 font-black uppercase text-[9px] tracking-widest">Sin registros en esta sección</p>
                </div>
              ) : (
                filteredData.map((item: any, idx) => {
                  if (item.type === 'client') {
                     return (
                      <div key={idx} className="flex items-center justify-between py-3 border-b border-slate-200 px-2 bg-white first:rounded-t-2xl last:rounded-b-2xl last:border-0 shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center font-black text-[10px] text-slate-400">
                            {item.client.name?.[0] || '?'}
                          </div>
                          <div>
                            <h4 className="font-black text-slate-950 text-[11px] uppercase tracking-tight leading-none">{item.client.name}</h4>
                            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-1">{item.client.neighborhood || 'Sin zona'}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">REGISTRADO</p>
                          <p className="text-[10px] font-black text-slate-900 tracking-tight">{item.client.phone || ''}</p>
                        </div>
                      </div>
                    );
                  }

                  if (item.type === 'loan_today' || item.type === 'payment_today') {
                    const isLoan = item.type === 'loan_today';
                    return (
                      <div key={idx} className="flex items-center justify-between py-3 border-b border-slate-200 px-2 bg-white first:rounded-t-2xl last:rounded-b-2xl last:border-0 shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-2 h-2 rounded-full", isLoan ? "bg-blue-500" : "bg-green-500")}></div>
                          <div>
                            <p className="text-[11px] font-black text-slate-900 uppercase leading-none">{item.client?.name || '---'}</p>
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter mt-1">
                              {isLoan ? 'Préstamo Entregado' : 'Cobro Realizado'}
                            </p>
                          </div>
                        </div>
                        <p className={cn("text-xs font-black", isLoan ? "text-blue-600" : "text-green-600")}>
                          {isLoan ? `-$${Number(item.loan.amount).toLocaleString()}` : `+$${Number(item.payment.amount).toLocaleString()}`}
                        </p>
                      </div>
                    );
                  }

                  if (item.type === 'loan_status') {
                    const { client, loan, remaining, isDelayed, isExpired } = item;
                     return (
                      <div key={loan.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between gap-4 mb-2">
                        <div className="flex items-center gap-4 flex-1">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs uppercase",
                            isExpired ? "bg-slate-950 text-white" : isDelayed ? "bg-red-100 text-red-600" : "bg-slate-50 text-slate-400"
                          )}>
                            {client?.name?.[0] || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-black text-slate-900 text-sm truncate uppercase tracking-tight">{client?.name || '---'}</h4>
                            <div className="flex items-center gap-2 mt-0.5">
                              {isExpired && <span className="bg-slate-950 text-white text-[8px] font-black px-1.5 py-0.5 rounded leading-none uppercase">Vencido</span>}
                              {isDelayed && <span className="bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded leading-none uppercase">Falta</span>}
                              {!isExpired && !isDelayed && <span className="text-[9px] font-bold text-slate-400 uppercase">{client?.neighborhood || 'Zona'}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Resta</p>
                           <p className="text-sm font-black text-slate-950">${remaining.toLocaleString()}</p>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })
              )}
            </div>
          </div>
        )}
      </main>


      <AnimatePresence>
        {workerToDelete && (
          <ConfirmModal 
            isOpen={true} 
            title="¿Eliminar Colaborador?" 
            message={`Se revocará el acceso de ${workerToDelete.name.toUpperCase()} y dejarás de recibir sus reportes. Esta acción no se puede deshacer.`}
            onCancel={() => setWorkerToDelete(null)}
            onConfirm={async () => {
              const worker = workerToDelete;
              setWorkerToDelete(null);
              setLocalIsSyncing(true);
              try {
                const updatedTeam = team.filter(w => w.name !== worker.name);
                const success = await onUpdateTeam(updatedTeam);
                if (success) {
                  if (selectedWorkerName === worker.name) {
                    setSelectedWorkerName(null);
                  }
                }
              } catch (err) {
                console.error("Error deleting worker:", err);
              } finally {
                setLocalIsSyncing(false);
              }
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAddWorker && (
          <AddWorkerModal 
            isSyncing={isSyncing}
            onClose={() => setShowAddWorker(false)}
            onAdd={async (name, pin) => {
              const n = name.trim();
              if (team.some(w => w.name.toUpperCase() === n.toUpperCase())) return showAlert("AVISO", "Este usuario ya está en tu equipo");
              const success = await onUpdateTeam([...team, { name: n, pin: pin.trim() }], n);
              if (success) setShowAddWorker(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function AddWorkerModal({ onClose, onAdd, isSyncing }: { onClose: () => void, onAdd: (name: string, pin: string) => void, isSyncing: boolean }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-[40px] w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="p-8 space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-4">
              {isSyncing ? <RefreshCw className="animate-spin" size={32} /> : <UserPlus size={32} />}
            </div>
            <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Vincular Colaborador</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              {isSyncing ? 'Verificando en el sistema...' : 'El colaborador debe existir previamente'}
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nombre de Usuario</label>
              <input 
                type="text"
                disabled={isSyncing}
                placeholder="EJ: juan_cobro"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold text-slate-900 outline-none placeholder:text-slate-300 focus:border-blue-500 transition-all disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Clave de Acceso</label>
              <div className="relative">
                <input 
                  type={showPin ? "text" : "password"}
                  disabled={isSyncing}
                  placeholder="Ej: 929..."
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold text-slate-900 outline-none placeholder:text-slate-300 focus:border-blue-500 transition-all font-mono tracking-widest text-lg disabled:opacity-50"
                />
                <button 
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900"
                >
                  {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="p-4 bg-slate-50 flex gap-3">
          <button disabled={isSyncing} onClick={onClose} className="flex-1 py-4 rounded-2xl font-black text-[10px] text-slate-400 uppercase tracking-widest hover:bg-slate-100 transition-all disabled:opacity-30">Cancelar</button>
          <button 
            disabled={isSyncing}
            onClick={() => {
              if (name.length < 3) return alert("Completa el nombre correctamente.");
              if (pin.length < 11) return alert("⚠️ La clave está incompleta. Por favor, coloque los 11 números completos (Ej: 929...).");
              if (/^(\d)\1+$/.test(pin)) return alert("⚠️ Clave no permitida. No use números repetidos (Ej: 1111...).");
              if (/^(01234567890|12345678901|12345678910)$/.test(pin)) return alert("⚠️ Clave no permitida. Por favor usa una clave más segura.");
              onAdd(name, pin);
            }} 
            className="flex-2 py-4 rounded-2xl font-black text-[10px] bg-slate-950 text-white shadow-xl uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50"
          >
            {isSyncing ? 'Verificando...' : 'Vincular Acceso'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}


function LoginScreen({ onLogin, onAdminLogin, isSyncing, isAdminSyncing }: { 
  onLogin: (u: string, p: string, isRegister: boolean) => void, 
  onAdminLogin: (u: string, p: string, isRegister: boolean) => Promise<boolean>, 
  isSyncing: boolean,
  isAdminSyncing: boolean
}) {
  const [user, setUser] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [imageError, setImageError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !pin) return;
    
    if (!isAdminLogin) {
      if (pin.length < 11) {
        alert("⚠️ La clave está incompleta. Por favor, coloque los 11 números completos (Ej: 929...).");
        return;
      }
      if (/^(\d)\1+$/.test(pin)) {
        alert("⚠️ Clave no permitida. No use números repetidos (Ej: 1111...).");
        return;
      }
      if (/^(01234567890|12345678901|12345678910)$/.test(pin)) {
        alert("⚠️ Clave no permitida. Por favor usa una clave más segura.");
        return;
      }
    }

    if (isAdminLogin) {
      await onAdminLogin(user, pin, false);
    } else {
      onLogin(user, pin, false);
    }
  };

  const isAnySyncing = isSyncing || isAdminSyncing;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-center p-6">
      {/* Background Decor */}
      <div className="absolute top-[-20%] right-[-10%] w-[70%] h-[70%] bg-blue-600/10 blur-[140px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-15%] left-[-10%] w-[70%] h-[70%] bg-purple-600/10 blur-[140px] rounded-full pointer-events-none"></div>
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm relative"
      >
        <div className="text-center mb-8">
          {!imageError ? (
            <img 
              src="/icon.png" 
              alt="Cobroya Logo" 
              className="w-32 h-32 mx-auto object-cover rounded-[30px] shadow-2xl mb-6 bg-slate-900 aspect-square"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className={cn(
              "w-20 h-20 rounded-[30px] mx-auto flex items-center justify-center shadow-lg mb-4 transition-all duration-500",
              isAdminLogin ? "bg-red-600 shadow-red-900/40" : "bg-blue-600 shadow-blue-900/40"
            )}>
              {isAdminLogin ? (
                <Shield size={40} className="text-white" strokeWidth={2.5} />
              ) : (
                <Wallet size={40} className="text-white" strokeWidth={2.5} />
              )}
            </div>
          )}
          <h1 className="text-4xl font-black text-white tracking-tighter">
            {isAdminLogin ? 'CobroJefe' : 'Cobroya'}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl border border-white/10 p-8 rounded-[40px] shadow-2xl space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                {isAdminLogin ? 'Usuario Admin' : 'Nombre de Usuario'}
              </label>
              <div className="relative">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500">
                  {isAdminLogin ? <Lock size={20} /> : <User size={20} />}
                </div>
                <input 
                  type="text"
                  required
                  value={user}
                  onChange={e => setUser(e.target.value)}
                  placeholder={isAdminLogin ? "Admin User" : "EJ: juan_cobro"}
                  className="w-full bg-black/20 border border-white/5 p-5 pl-14 rounded-2xl font-bold text-white focus:border-blue-500 outline-none transition-all placeholder:text-slate-600 shadow-inner"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                {isAdminLogin ? 'Contraseña Admin' : 'Clave de Acceso Telefono'}
              </label>
              <div className="relative">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500">
                  {isAdminLogin ? <Shield size={20} /> : <Phone size={20} />}
                </div>
                <input 
                  type={showPin ? "text" : "password"}
                  inputMode={isAdminLogin ? "text" : "numeric"}
                  required
                  maxLength={isAdminLogin ? 20 : 11}
                  value={pin}
                  onChange={e => {
                    const val = e.target.value;
                    if (isAdminLogin) {
                      setPin(val.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20));
                    } else {
                      setPin(val.replace(/\D/g, '').slice(0, 11));
                    }
                  }}
                  placeholder={isAdminLogin ? "Letras, números y _" : "Ej: 929..."}
                  className="w-full bg-black/20 border border-white/5 p-5 pl-14 pr-14 rounded-2xl font-bold text-white focus:border-blue-500 outline-none transition-all placeholder:text-slate-600 tracking-widest shadow-inner"
                />
                <button 
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                  tabIndex={-1}
                >
                  {showPin ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
          </div>

          <button 
            type="submit"
            disabled={isAnySyncing}
            className={cn(
              "w-full text-white p-6 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50",
              isAdminLogin ? "bg-red-600 hover:bg-red-500 shadow-red-900/20" : "bg-blue-600 hover:bg-blue-500 shadow-blue-900/20"
            )}
          >
            {isAnySyncing ? (
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                {isAdminLogin ? 'ACCESO JEFE' : 'ENTRAR'}
                <ArrowRight size={20} strokeWidth={3} />
              </>
            )}
          </button>

          {isAdminLogin ? (
            <div className="pt-2 text-center space-y-4">
              <div className="pt-4 border-t border-white/5">
                <button 
                   type="button"
                   onClick={() => setIsAdminLogin(false)}
                   className="text-[10px] font-black text-blue-500 hover:text-blue-400 uppercase tracking-widest transition-colors w-full"
                >
                  Regresar a Portal de Cobrador
                </button>
              </div>
            </div>
          ) : (
            <div className="pt-2 text-center space-y-4">
              <div className="pt-4 border-t border-white/5">
                <button 
                   type="button"
                   onClick={() => setIsAdminLogin(true)}
                   className="text-[10px] font-black text-red-500 hover:text-red-400 uppercase tracking-widest transition-colors w-full"
                >
                  Acceso Jefe de Cobro / Crear Admin
                </button>
              </div>
            </div>
          )}
        </form>

        <p className="mt-8 text-center text-[10px] font-black text-slate-700 uppercase tracking-[0.4em]">
          Cobroya System 2025
        </p>
      </motion.div>
    </div>
  );
}

// --- Navigation ---

function NavButton({ active, icon, label, onClick }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all duration-300 min-w-[64px]",
        active ? "text-blue-600 bg-blue-50 scale-105" : "text-slate-400"
      )}
    >
      <div className={cn("transition-all duration-300", active ? "mb-0.5" : "")}>
        {icon}
      </div>
      <span className={cn("text-[8px] font-black uppercase tracking-tighter transition-all", active ? "opacity-100" : "opacity-0 h-0 overflow-hidden")}>
        {label}
      </span>
    </button>
  );
}

// --- Screens ---

function HomeScreen({ loans, payments, clients, onOpenPayment }: { loans: Loan[], payments: Payment[], clients: Client[], onOpenPayment: (loan: Loan) => void }) {
  const [filterType, setFilterType] = useState<'todos' | 'atrasados' | 'vencidos'>('todos');

  // Filtrar solo préstamos activos que NO han pagado hoy
  const pendingLoans = useMemo(() => {
    // Préstamos que NO han pagado hoy
    const nonPaidToday = loans.filter(loan => !hasPaidToday(loan.id!, payments));
    
    // Préstamos que YA estaban activos antes de hoy (Pendientes de Cobro)
    let filtered = nonPaidToday.filter(loan => !isToday(loan.startDate));

    // Filtros por estado para los pendientes
    if (filterType === 'atrasados') {
      filtered = filtered.filter(loan => {
        const clientPayments = payments.filter(p => p.loanId === loan.id);
        const status = getLoanStatus(loan, clientPayments);
        return status === 'yellow' || status === 'red';
      });
    } else if (filterType === 'vencidos') {
      filtered = filtered.filter(loan => {
        const clientPayments = payments.filter(p => p.loanId === loan.id);
        const status = getLoanStatus(loan, clientPayments);
        return status === 'expired';
      });
    }

    return filtered;
  }, [loans, payments, filterType]);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="space-y-4 mb-2">
        <div className="flex gap-2">
          {(['todos', 'atrasados', 'vencidos'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={cn(
                "flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all border-2",
                filterType === type 
                  ? "bg-slate-950 border-slate-950 text-white shadow-lg" 
                  : "bg-white border-slate-200 text-slate-400"
              )}
            >
              {type === 'todos' ? 'Todos' : type === 'atrasados' ? 'Atrasados' : 'Vencidos'}
            </button>
          ))}
        </div>
      </div>

      <SectionTitle title={filterType === 'todos' ? "Pendientes de hoy" : "Resultados"} count={pendingLoans.length} />
      
      {pendingLoans.length === 0 ? (
        <EmptyState 
          icon={filterType !== 'todos' ? <Search className="text-slate-300" /> : <CheckCircle className="text-green-500" />} 
          message={filterType !== 'todos' ? "No se encontraron resultados." : "¡Excelente! Todo cobrado por hoy."} 
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {pendingLoans.map((loan, idx) => (
            <CompactLoanItem 
              key={loan.id || idx}
              loan={loan}
              client={clients.find(c => c.id === loan.clientId)}
              payments={payments.filter(p => p.loanId === loan.id)}
              onClick={() => onOpenPayment(loan)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CompactLoanItemProps {
  loan: Loan;
  client?: Client;
  payments: Payment[];
  onClick: () => void;
}

const CompactLoanItem: React.FC<CompactLoanItemProps> = ({ loan, client, payments, onClick }) => {
  const status = getLoanStatus(loan, payments);
  const { installmentsPaid } = getInstallmentsInfo(loan, payments);

  const statusBorder = {
    green: "border-l-green-600 bg-green-50/30",
    yellow: "border-l-yellow-500 bg-yellow-50/30",
    red: "border-l-red-600 bg-red-50/30",
    expired: "border-l-slate-900 bg-slate-900/5",
    completed: "border-l-blue-600 bg-blue-50/30"
  };

  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full bg-white p-5 rounded-[24px] border-2 border-slate-300 border-l-[10px] flex justify-between items-center shadow-md active:scale-[0.97] transition-all text-left relative overflow-hidden",
        statusBorder[status as keyof typeof statusBorder]
      )}
    >
      {isToday(loan.createdAt) && loan.note === 'RENOVACIÓN' && (
        <div className="absolute top-0 right-0 bg-red-100 text-red-700 text-[7px] font-black px-2 py-1 rounded-bl-xl border-l border-b border-red-200 uppercase tracking-tighter shadow-sm animate-pulse z-10">
          RENOVACIÓN
        </div>
      )}
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span className="font-black text-slate-950 text-lg leading-tight truncate max-w-[150px]">{client?.name || 'Cargando...'}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[11px] text-slate-900 font-black bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-300 uppercase">Cuota: ${Math.round(loan.dailyPayment)}</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-[10px] text-slate-500 font-black uppercase tracking-tighter">Progreso</p>
          <p className="text-base font-black text-slate-950">{installmentsPaid} / {loan.days}</p>
        </div>
        <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center border border-slate-300">
          <ChevronRight size={20} strokeWidth={3} className="text-slate-900" />
        </div>
      </div>
    </button>
  );
};

function PaymentModal({ 
  loan, 
  client, 
  onClose, 
  onConfirm,
  payments
}: { 
  loan: Loan | null, 
  client?: Client, 
  onClose: () => void, 
  onConfirm: (id: number, amount: number, note?: string) => void,
  payments: Payment[]
}) {
  const [amount, setAmount] = useState<string>('');

  useEffect(() => {
    if (loan) setAmount(loan.dailyPayment.toString());
  }, [loan]);

  if (!loan) return null;

  const loanPayments = payments.filter(p => p.loanId === loan.id);
  const totalPaid = loanPayments.reduce((acc, p) => acc + p.amount, 0);
  const remaining = Math.max(0, loan.totalToPay - totalPaid);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return;
    
    // Si el monto ingresado es exactamente el restante, lo enviamos como DESCUENTO
    const isRenewal = Math.abs(Number(amount) - remaining) < 0.01;
    onConfirm(loan.id!, Number(amount), isRenewal ? 'DESCUENTO' : undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <motion.div 
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-white w-full max-w-sm rounded-[40px] p-8 shadow-2xl border-4 border-slate-100"
      >
        <div className="flex justify-between items-start mb-8">
          <div>
            <h3 className="text-2xl font-black text-slate-950 tracking-tighter leading-tight">{client?.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Cuota: ${Math.round(loan.dailyPayment)}</p>
              <div className="w-1 h-1 bg-slate-300 rounded-full"></div>
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest text-right">Resta: ${Math.round(remaining)}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 bg-slate-50 rounded-full"><Plus className="rotate-45" size={24} strokeWidth={3} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-950 uppercase tracking-widest ml-1 text-center block">¿Cuánto recibe hoy?</label>
            <div className="relative">
              <span className="absolute left-6 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-300">$</span>
              <input 
                autoFocus
                type="number" 
                inputMode="decimal"
                className="w-full pl-12 pr-6 py-6 bg-slate-50 border-2 border-slate-200 rounded-[28px] focus:ring-8 focus:ring-blue-600/10 focus:border-blue-600 text-3xl font-black text-slate-950 outline-none text-center transition-all"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>
            {Math.abs(Number(amount) - remaining) < 0.01 && Number(amount) > 0 && (
              <div className="bg-yellow-400 text-slate-950 text-[10px] font-black py-2 rounded-2xl text-center uppercase tracking-widest border border-yellow-500 animate-pulse mt-2 shadow-sm">
                Descuento Detectado
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Botón de Descuento */}
            <button 
              type="button"
              onClick={() => setAmount(remaining.toString())}
              className="py-3 px-1 bg-yellow-400 border-2 border-yellow-500 rounded-2xl text-[9px] font-black text-slate-950 uppercase active:bg-yellow-500 flex flex-col items-center justify-center gap-0.5 shadow-sm"
            >
              DESCUENTO
            </button>

            {[loan.dailyPayment, loan.dailyPayment * 2].map(quickAmnt => (
              <button 
                key={quickAmnt}
                type="button"
                onClick={() => setAmount(quickAmnt.toString())}
                className="py-3 px-1 bg-slate-100 border-2 border-slate-200 rounded-2xl text-[9px] font-black text-slate-950 uppercase active:bg-slate-200 flex flex-col items-center justify-center gap-0.5"
              >
                <span className="text-sm">${Math.round(quickAmnt)}</span>
                COBRO
              </button>
            ))}
          </div>

          <button 
            type="submit"
            className="w-full py-6 bg-blue-600 text-white rounded-[28px] font-black text-lg shadow-xl shadow-blue-200 active:scale-95 transition-all uppercase tracking-widest"
          >
            CONFIRMAR COBRO
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function PaidTodayScreen({ loans, payments, clients }: { loans: Loan[], payments: Payment[], clients: Client[] }) {
  const paidToday = payments.filter(p => isToday(p.date)).sort((a, b) => b.date.getTime() - a.date.getTime()).map(p => {
    const loan = loans.find(l => l.id === p.loanId);
    const client = clients.find(c => c.id === loan?.clientId);
    
    // Calcular el restante del préstamo
    let remaining = 0;
    if (loan) {
      const loanPayments = payments.filter(pay => pay.loanId === loan.id);
      const totalPaid = loanPayments.reduce((acc, pay) => acc + pay.amount, 0);
      remaining = Math.max(0, loan.totalToPay - totalPaid);
    }

    return { payment: p, loan, client, remaining };
  });

  const loansCreatedToday = loans.filter(l => isToday(l.createdAt)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <SectionTitle title="Pagado Hoy" count={paidToday.length} />
        {paidToday.length === 0 ? (
          <EmptyState icon={<CheckCircle className="text-slate-300" />} message="No se han registrado pagos hoy." />
        ) : (
          <div className="space-y-4">
            {paidToday.map(({ payment, loan, client, remaining }) => (
              <div key={payment.id} className="bg-white p-5 rounded-[24px] shadow-md border-2 border-green-100 flex justify-between items-center active:scale-[0.98] transition-all relative overflow-hidden">
                {isToday(payment.date) && payment.note === 'DESCUENTO' && (
                  <div className="absolute top-0 right-0 bg-yellow-400 text-slate-950 text-[8px] font-black px-3 py-1 rounded-bl-xl border-l border-b border-yellow-500 uppercase tracking-tighter shadow-sm animate-pulse z-10">
                    DESCUENTO
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-black text-slate-950 text-lg leading-tight">{client?.name || 'Cliente desconocido'}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-[11px] text-slate-600 font-bold">{format(payment.date, 'hh:mm a')}</p>
                    <span className="text-[11px] bg-green-50 text-green-700 px-2 py-0.5 rounded-lg border border-green-200 font-extrabold uppercase">Resta: ${Math.round(remaining)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-black text-green-600 text-xl">${Math.round(payment.amount)}</p>
                  <p className="text-[11px] text-slate-500 font-black uppercase tracking-tighter">Cobrado</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {loansCreatedToday.length > 0 && (
        <div className="space-y-4">
          <SectionTitle title="Préstamos Hoy" count={loansCreatedToday.length} />
          <div className="space-y-4">
            {loansCreatedToday.map((loan, idx) => {
              const client = clients.find(c => c.id === loan.clientId);
              return (
                <div key={loan.id || `l-${idx}`} className="bg-white p-5 rounded-[24px] shadow-md border-2 border-red-50 flex justify-between items-center active:scale-[0.98] transition-all border-l-8 border-l-red-500 relative overflow-hidden">
                {isToday(loan.createdAt) && loan.note === 'RENOVACIÓN' && (
                  <div className="absolute top-0 right-0 bg-red-100 text-red-700 text-[7px] font-black px-3 py-1 rounded-bl-xl border-l border-b border-red-200 uppercase tracking-tighter shadow-sm animate-pulse z-10">
                    RENOVACIÓN
                  </div>
                )}
                  <div>
                    <p className="font-black text-slate-950 text-lg leading-tight">{client?.name || 'Cliente'}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock size={12} className="text-slate-400" />
                      <p className="text-[11px] text-slate-600 font-bold">{format(loan.createdAt, 'hh:mm a')}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-red-500 text-xl">${Math.round(loan.amount)}</p>
                    <p className="text-[11px] text-slate-500 font-black uppercase tracking-tighter">Salida</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ClientsScreen({ clients, onDeleteRequest }: { clients: Client[], onDeleteRequest: (id: number) => void }) {
  const [searchTerm, setSearchTerm] = useState('');
  const filteredClients = clients.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-6">
      <SectionTitle title="Mis Clientes" count={clients.length} />
      <div className="relative group px-1">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={20} strokeWidth={2.5} />
        <input 
          type="text" 
          placeholder="Buscar un cliente..." 
          className="w-full pl-14 pr-6 py-5 bg-white border-2 border-slate-200 rounded-[28px] focus:outline-none focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 font-black text-slate-950 transition-all shadow-sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="space-y-4">
        {filteredClients.map(client => (
          <div key={client.id} className="bg-white p-5 rounded-[32px] border-2 border-slate-200 flex justify-between items-center group shadow-sm active:scale-[0.98] transition-all">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 bg-blue-600 text-white rounded-full flex items-center justify-center text-xl font-black shadow-lg shadow-blue-100">
                {client.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-black text-slate-950 text-lg leading-tight">{client.name}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 font-bold text-xs mt-1">
                  {client.identity && (
                    <div className="flex items-center gap-1.5">
                      <AlertCircle size={12} strokeWidth={3} />
                      <span className="text-slate-950">ID: {client.identity}</span>
                    </div>
                  )}
                  {client.phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone size={12} strokeWidth={3} />
                      <span>{client.phone}</span>
                    </div>
                  )}
                  {client.address && (
                    <button 
                      onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address!)}`, '_blank')}
                      className="flex items-center gap-1.5 text-amber-600 hover:text-amber-700 transition-colors cursor-pointer"
                    >
                      <MapPin size={12} strokeWidth={3} />
                      <span className="truncate max-w-[150px]">{client.address}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
            <button 
              onClick={() => onDeleteRequest(client.id!)}
              className="p-3 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 size={24} strokeWidth={2.5} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoansScreen({ loans, clients, payments, onDeleteRequest }: { loans: Loan[], clients: Client[], payments: Payment[], onDeleteRequest: (id: number) => void }) {
  return (
    <div className="space-y-6">
      <SectionTitle title="Préstamos Activos" count={loans.length} />
      <div className="space-y-6">
        {loans.map((loan, idx) => (
          <div key={loan.id || idx} className="relative group px-1">
            <LoanCard 
              loan={loan} 
              client={clients.find(c => c.id === loan.clientId)}
              payments={payments.filter(p => p.loanId === loan.id)}
              onPay={() => {}} // No action here
              showDetails
            />
            <button 
              onClick={() => onDeleteRequest(loan.id!)}
              className="absolute top-4 right-4 p-3 text-red-500 bg-white shadow-xl rounded-full border-2 border-slate-100 opacity-0 group-hover:opacity-100 transition-all active:scale-95"
            >
              <Trash2 size={24} strokeWidth={2.5} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryScreen({ 
  allPayments, 
  clients, 
  loans, 
  activeLoansCount,
  userName,
  backupPin,
  isBackupActive,
  onSaveSettings,
  onCloudSave,
  onCloudRestore,
  isSyncing,
  onLogout,
}: { 
  allPayments: Payment[], 
  clients: Client[], 
  loans: Loan[], 
  activeLoansCount: number,
  userName: string,
  backupPin: string,
  isBackupActive: boolean,
  onSaveSettings: (user: string, pin: string, isRegister?: boolean) => void,
  onCloudSave: (isAuto: boolean, u?: string, p?: string) => Promise<void>,
  onCloudRestore: (u?: string, p?: string, silent?: boolean) => Promise<any>,
  isSyncing: boolean,
  onLogout: () => void,
}) {
  const [showHistorySearch, setShowHistorySearch] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [manualCash, setManualCash] = useState('');
  const [showConsultModal, setShowConsultModal] = useState(false);
  const [consultTab, setConsultTab] = useState<'search' | 'upload'>('search');
  const [consultId, setConsultId] = useState('');
  const [consultPhone, setConsultPhone] = useState('');
  const [consultIdentity, setConsultIdentity] = useState('');
  const [consultRef, setConsultRef] = useState('');
  const [consultStatus, setConsultStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error', message?: string }>({ type: 'idle' });
  const [searchResult, setSearchResult] = useState<string | null>(null);

  const handleConsultAction = async () => {
    setConsultStatus({ type: 'loading' });
    setSearchResult(null);

    try {
      if (consultTab === 'upload') {
        if (!consultPhone.trim() && !consultIdentity.trim()) {
          setConsultStatus({ type: 'error', message: 'Indica un teléfono o ID' });
          return;
        }
        if (!consultRef.trim()) {
          setConsultStatus({ type: 'error', message: 'Escribe una referencia' });
          return;
        }

        const formData = new URLSearchParams();
        formData.append('action', 'guardar_referencia');
        formData.append('id', consultIdentity.trim());
        formData.append('telefono', consultPhone.trim());
        formData.append('referencia', consultRef.trim());
        formData.append('nombre_usuario', userName);

        await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'guardar_referencia',
            id: consultIdentity.trim(),
            telefono: consultPhone.trim(),
            referencia: consultRef.trim(),
            nombre_usuario: userName
          })
        });

        setConsultStatus({ type: 'success', message: '¡Información guardada!' });
        setConsultPhone('');
        setConsultIdentity('');
        setConsultRef('');
      } else {
        // Search
        if (!consultId.trim()) {
          setConsultStatus({ type: 'error', message: 'Ingresa un dato para buscar' });
          return;
        }

        const response = await fetch(`${APPS_SCRIPT_URL}?action=buscar_referencia&query=${encodeURIComponent(consultId.trim())}`);
        const result = await response.json();

        if (result.status === 'ok' && result.referencia) {
          setSearchResult(result.referencia);
          setConsultStatus({ type: 'success' });
        } else {
          setConsultStatus({ type: 'error', message: 'No se encontró información' });
        }
      }
    } catch (error) {
      console.error('Error in consult:', error);
      if (consultTab === 'upload') {
        setConsultStatus({ type: 'success', message: 'Procesando subida...' });
      } else {
        setConsultStatus({ type: 'error', message: 'Error de conexión' });
      }
    }
  };

  // Cálculos estadísticos diarios
  const activeLoans = loans.filter(l => l.status === 'active');
  const dailyGoal = activeLoans.reduce((acc, l) => acc + l.dailyPayment, 0);
  
  const paymentsToday = allPayments.filter(p => isToday(p.date)).sort((a, b) => b.date.getTime() - a.date.getTime());
  const incomeToday = paymentsToday.reduce((acc, p) => acc + p.amount, 0);

  // Suma de descuentos (pagos de renovación)
  const totalDiscountsToday = paymentsToday
    .filter(p => p.note === 'DESCUENTO')
    .reduce((acc, p) => acc + p.amount, 0);

  const realCashFlowToday = incomeToday - totalDiscountsToday;
  const pixResult = Math.max(0, realCashFlowToday - (parseFloat(manualCash) || 0));

  // Clientes totales con préstamos activos
  const totalActiveClientIds = new Set(activeLoans.map(l => l.clientId));
  const totalActiveClientsCount = totalActiveClientIds.size;

  // Clientes que pagaron hoy
  const clientIdsPaidToday = new Set(paymentsToday.map(p => {
    const loan = loans.find(l => l.id === p.loanId);
    return loan?.clientId;
  }).filter(id => id !== undefined));
  const numClientsPaidToday = clientIdsPaidToday.size;

  // Clientes por pagar
  const clientsPendingCount = Math.max(0, totalActiveClientsCount - numClientsPaidToday);

  const loansCreatedToday = loans.filter(l => isToday(l.createdAt)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const investedToday = loansCreatedToday.reduce((acc, l) => acc + l.amount, 0);
  
  const totalIncomeAllTime = allPayments.reduce((acc, p) => acc + p.amount, 0);
  const totalInvestedAllTime = loans.reduce((acc, l) => acc + l.amount, 0);
  const availableCash = totalIncomeAllTime - totalInvestedAllTime;
  
  const netBalanceToday = incomeToday - investedToday;

  return (
    <div className="space-y-6 pb-24">
      {/* Tarjeta de Control Maestro (Negra) */}
      <div className="bg-slate-950 rounded-[32px] p-6 text-white shadow-2xl relative overflow-hidden border-2 border-slate-900">
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 blur-3xl -mr-8 -mt-8 rounded-full"></div>
        
        {/* Header con Fecha */}
        <div className="relative z-10 flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-blue-500" strokeWidth={3} />
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Resumen Financiero</h2>
          </div>
          <span className="text-[9px] font-black bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-slate-400">
            {format(new Date(), 'd MMM', { locale: es }).toUpperCase()}
          </span>
        </div>

        {/* Caja Disponible */}
        <div className="relative z-10 bg-white/5 backdrop-blur-md rounded-[28px] p-5 border border-white/10 mb-6 flex justify-between items-end">
          <div>
            <p className="text-[10px] font-black uppercase text-slate-300 tracking-widest mb-1">Caja Disponible</p>
            <p className={cn("text-4xl font-black tracking-tighter leading-none", availableCash >= 0 ? "text-green-500" : "text-red-500")}>
              ${Math.round(availableCash)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black uppercase text-slate-500 tracking-widest mb-1">Mov. Hoy</p>
            <p className={cn("text-lg font-black leading-none", netBalanceToday >= 0 ? "text-green-500" : "text-red-500")}>
              {netBalanceToday >= 0 ? '+' : ''}${Math.round(netBalanceToday)}
            </p>
          </div>
        </div>

        {/* RESUMEN DE COBRO DIARIO (NUEVO) */}
        <div className="relative z-10 mb-6 bg-blue-600/10 border border-blue-500/20 rounded-3xl p-5">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <p className="text-[9px] font-black uppercase text-blue-400 tracking-[0.15em]">Control de Recaudación</p>
            </div>
            <p className="text-[9px] font-black text-slate-400">{Math.round((incomeToday / dailyGoal) * 100 || 0)}% COMPLETADO</p>
          </div>
          
          <div className="flex justify-between items-end">
            <div>
            <p className="text-[10px] font-black text-slate-300 uppercase mb-1">Total a Cobrar</p>
              <p className="text-2xl font-black text-white leading-none">${Math.round(dailyGoal)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-300 uppercase mb-1">Cobrado</p>
              <p className="text-2xl font-black text-green-500 leading-none">${Math.round(incomeToday)}</p>
            </div>
          </div>

          <div className="mt-4 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (incomeToday / dailyGoal) * 100 || 0)}%` }}
              className="h-full bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"
            />
          </div>
        </div>

        {/* Métricas Detalladas */}
        <div className="relative z-10 grid grid-cols-3 gap-2 mb-6">
          <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800 text-center">
            <p className="text-[7px] font-black uppercase text-slate-400 tracking-widest mb-1">Activos</p>
            <p className="text-sm font-black text-white">{totalActiveClientsCount}</p>
          </div>
          <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800 text-center">
            <p className="text-[7px] font-black uppercase text-green-400/80 tracking-widest mb-1">Pagaron</p>
            <p className="text-sm font-black text-green-500">{numClientsPaidToday}</p>
          </div>
          <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800 text-center">
            <p className="text-[7px] font-black uppercase text-amber-400/80 tracking-widest mb-1">Pendientes</p>
            <p className="text-sm font-black text-amber-500">{clientsPendingCount}</p>
          </div>
        </div>

        {/* Métricas de Flujo Hoy */}
        <div className="relative z-10 grid grid-cols-2 gap-3 mb-6">
          <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
            <div className="flex justify-between items-start mb-1">
              <p className="text-[8px] font-black uppercase text-blue-300 tracking-widest">Cobros Hoy</p>
              <CheckCircle size={10} className="text-green-500" strokeWidth={4} />
            </div>
            <p className="text-lg font-black text-white leading-none">${incomeToday}</p>
            <p className="text-[9px] font-black text-slate-300 mt-1.5 uppercase">{paymentsToday.length} RECIBOS</p>
          </div>
          
          <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
            <div className="flex justify-between items-start mb-1">
              <p className="text-[8px] font-black uppercase text-red-300 tracking-widest">Salida Hoy</p>
              <Plus size={10} className="text-red-500" strokeWidth={4} />
            </div>
            <p className="text-lg font-black text-white leading-none">${investedToday}</p>
            <p className="text-[9px] font-black text-slate-300 mt-1.5 uppercase">{loansCreatedToday.length} PRÉSTAMOS</p>
          </div>
        </div>

        {/* CALCULADORA MODAL (NUEVA) */}
        <AnimatePresence>
          {showCalculator && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowCalculator(false)}
                className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full max-w-sm bg-slate-900 border-2 border-slate-800 rounded-[40px] p-8 shadow-2xl overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"></div>
                
                <h3 className="text-white font-black text-2xl mb-6 text-center italic tracking-tighter">CUADRAR CAJA</h3>

                <div className="space-y-4">
                  <div className="bg-slate-800/50 p-4 rounded-3xl border border-slate-700">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Cobrado Hoy (App)</p>
                    <p className="text-xl font-black text-white">${Math.round(incomeToday)}</p>
                  </div>

                  <div className="bg-slate-800/50 p-4 rounded-3xl border border-slate-700">
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">Descuento (Renovación)</p>
                    <p className="text-xl font-black text-amber-500">-${Math.round(totalDiscountsToday)}</p>
                  </div>

                  <div className="bg-slate-950 p-5 rounded-3xl border-2 border-blue-500/30">
                    <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-2 block">Efectivo en Mano ($)</label>
                    <input 
                      type="tel"
                      inputMode="numeric"
                      value={manualCash}
                      onChange={(e) => setManualCash(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-transparent text-3xl font-black text-white outline-none placeholder:text-slate-800"
                    />
                  </div>

                  <div className="pt-4 border-t border-slate-800">
                    <div className="flex justify-between items-center mb-2">
                       <p className="text-[11px] font-black text-slate-400 uppercase">Resultado Total PIX</p>
                       <div className="px-2 py-0.5 bg-blue-500/10 rounded-full border border-blue-500/20">
                          <p className="text-[8px] font-black text-blue-400 uppercase">ELECTRÓNICO</p>
                       </div>
                    </div>
                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-[32px] border-2 border-slate-700 text-center shadow-xl">
                      <p className="text-5xl font-black text-blue-500 tracking-tighter shadow-blue-500/20 drop-shadow-lg">
                        ${Math.round(pixResult)}
                      </p>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setShowCalculator(false)}
                  className="w-full mt-6 py-4 bg-slate-800 text-slate-400 font-black rounded-3xl hover:bg-slate-700 transition-colors uppercase text-xs tracking-widest"
                >
                  Cerrar
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* CONSULTA MODAL (NUEVA) */}
        <AnimatePresence>
          {showConsultModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowConsultModal(false)}
                className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full max-w-sm bg-slate-900 border-2 border-slate-800 rounded-[40px] p-8 shadow-2xl overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 via-blue-500 to-green-500"></div>
                
                <div className="flex bg-slate-950 p-1 rounded-2xl mb-6">
                  <button 
                    onClick={() => { setConsultTab('search'); setConsultStatus({ type: 'idle' }); setSearchResult(null); }}
                    className={cn(
                      "flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                      consultTab === 'search' ? "bg-purple-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                    )}
                  >
                    Buscar
                  </button>
                  <button 
                    onClick={() => { setConsultTab('upload'); setConsultStatus({ type: 'idle' }); setSearchResult(null); }}
                    className={cn(
                      "flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                      consultTab === 'upload' ? "bg-blue-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                    )}
                  >
                    Subir Info
                  </button>
                </div>

                <div className="space-y-4">
                  {consultTab === 'search' ? (
                    <div className="bg-slate-950 p-5 rounded-3xl border-2 border-slate-800 focus-within:border-purple-500/50 transition-all">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">
                        Buscar Teléfono o ID
                      </label>
                      <input 
                        type="tel"
                        value={consultId}
                        onChange={(e) => setConsultId(e.target.value)}
                        placeholder="Ej: 929..."
                        className="w-full bg-transparent text-xl font-black text-white outline-none placeholder:text-slate-800"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="bg-slate-950 p-5 rounded-3xl border-2 border-slate-800 focus-within:border-blue-500/50 transition-all">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Número de Teléfono</label>
                        <input 
                          type="tel"
                          value={consultPhone}
                          onChange={(e) => setConsultPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                          placeholder="92..."
                          className="w-full bg-transparent text-xl font-black text-white outline-none placeholder:text-slate-800"
                        />
                      </div>
                      <div className="bg-slate-950 p-5 rounded-3xl border-2 border-slate-800 focus-within:border-blue-500/50 transition-all">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Documento o ID</label>
                        <input 
                          type="text"
                          value={consultIdentity}
                          onChange={(e) => setConsultIdentity(e.target.value)}
                          placeholder="Identidad..."
                          className="w-full bg-transparent text-xl font-black text-white outline-none placeholder:text-slate-800"
                        />
                      </div>
                      <div className="bg-slate-950 p-5 rounded-3xl border-2 border-slate-800 focus-within:border-blue-500/50 transition-all">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Referencia / Nota</label>
                        <textarea 
                          value={consultRef}
                          onChange={(e) => setConsultRef(e.target.value)}
                          placeholder="Escribe la referencia aquí..."
                          rows={2}
                          className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder:text-slate-800 resize-none"
                        />
                      </div>
                    </>
                  )}

                  {consultStatus.type === 'error' && (
                    <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-2xl text-center">
                      <p className="text-[10px] font-black text-red-500 uppercase">{consultStatus.message}</p>
                    </div>
                  )}

                  {consultStatus.type === 'success' && consultStatus.message && (
                    <div className="bg-green-500/10 border border-green-500/20 p-3 rounded-2xl text-center">
                      <p className="text-[10px] font-black text-green-500 uppercase">{consultStatus.message}</p>
                    </div>
                  )}

                  {searchResult && (
                    <div className="bg-purple-500/10 border-2 border-purple-500/20 p-5 rounded-3xl">
                      <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-2">Referencia Encontrada:</p>
                      <p className="text-sm font-bold text-white italic">"{searchResult}"</p>
                    </div>
                  )}

                  <button 
                    disabled={consultStatus.type === 'loading'}
                    onClick={handleConsultAction}
                    className={cn(
                      "w-full py-4 rounded-3xl font-black uppercase text-xs tracking-widest shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 text-white",
                      consultTab === 'search' ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-600 hover:bg-blue-700",
                      consultStatus.type === 'loading' && "opacity-50 pointer-events-none"
                    )}
                  >
                    {consultStatus.type === 'loading' ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        {consultTab === 'search' ? <Search size={14} /> : <Upload size={14} />}
                        {consultTab === 'search' ? 'BUSCAR AHORA' : 'GUARDAR INFO'}
                      </>
                    )}
                  </button>
                </div>

                <button 
                  onClick={() => setShowConsultModal(false)}
                  className="w-full mt-4 py-3 text-slate-500 font-bold text-[10px] uppercase tracking-widest hover:text-slate-300 transition-colors"
                >
                  Cerrar
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Herramientas Rápidas */}
        <div className="relative z-10 grid grid-cols-2 gap-3">
          <button 
            onClick={() => setShowHistorySearch(true)}
            className="flex items-center justify-center gap-2 bg-white/5 border border-white/10 hover:bg-white/10 py-4 rounded-[22px] font-black uppercase text-[10px] tracking-widest transition-all active:scale-95"
          >
            <History size={16} className="text-blue-500" />
            Historial
          </button>
          
          <button 
            onClick={() => setShowConsultModal(true)}
            className="flex items-center justify-center gap-2 bg-white/5 border border-white/10 hover:bg-white/10 py-4 rounded-[22px] font-black uppercase text-[10px] tracking-widest transition-all active:scale-95"
          >
            <Search size={16} className="text-purple-500" />
            Consultar
          </button>

          <button 
            onClick={() => setShowCalculator(true)}
            className="flex items-center justify-center gap-2 bg-white/5 border border-white/10 hover:bg-white/10 py-4 rounded-[22px] font-black uppercase text-[10px] tracking-widest transition-all active:scale-95"
          >
            <Calculator size={16} className="text-blue-500" />
            Calcular
          </button>

          <button 
            onClick={() => setShowHelpModal(true)}
            className="flex items-center justify-center gap-2 bg-white/5 border border-white/10 hover:bg-white/10 py-4 rounded-[22px] font-black uppercase text-[10px] tracking-widest transition-all active:scale-95"
          >
            <HelpCircle size={16} className="text-amber-500" />
            Ayuda
          </button>
        </div>
      </div>

      {/* Sección Cloud (Blanca) */}
      <RespaldoSection 
        userName={userName}
        backupPin={backupPin}
        isBackupActive={isBackupActive}
        onSaveSettings={onSaveSettings}
        onCloudRestore={onCloudRestore}
        isSyncing={isSyncing}
        onLogout={onLogout}
      />

      <AnimatePresence>
        {showHistorySearch && (
          <HistorySearchModal 
            isOpen={showHistorySearch} 
            onClose={() => setShowHistorySearch(false)} 
            clients={clients} 
            allPayments={allPayments} 
            allLoans={loans}
          />
        )}
        {showHelpModal && (
          <PersonalizedHelpModal 
            isOpen={showHelpModal} 
            onClose={() => setShowHelpModal(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function RespaldoSection({ 
  userName, 
  backupPin, 
  isBackupActive,
  onCloudRestore, 
  isSyncing,
  onLogout
}: { 
  userName: string, 
  backupPin: string, 
  isBackupActive: boolean,
  onSaveSettings: (u: string, p: string) => void, 
  onCloudRestore: (u?: string, p?: string, silent?: boolean) => Promise<any>, 
  isSyncing: boolean,
  onLogout: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2 px-2">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-6 bg-blue-600 rounded-full"></div>
          <h2 className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Nube Cobroya</h2>
        </div>
        {isBackupActive && (
          <span className="flex items-center gap-1.5 text-[9px] font-black text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-200">
            <CheckCircle size={10} strokeWidth={3} /> EN LÍNEA
          </span>
        )}
      </div>
      
      <div className="bg-white border-2 border-slate-200 p-8 rounded-[40px] shadow-xl space-y-6">
        <div className="space-y-6">
          <div className="flex items-center gap-4 bg-slate-50 p-5 rounded-[28px] border border-slate-100">
            <div className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center shadow-lg">
              <Users size={24} />
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Identificador Activo</p>
              <p className="text-lg font-black text-slate-900 leading-none">{userName}</p>
            </div>
          </div>

          <div className="pt-4 border-t-2 border-slate-100">
            <div className="bg-slate-50 p-6 rounded-[32px] border-2 border-dashed border-slate-200">
              <p className="text-[9px] text-slate-500 font-black uppercase text-center mb-5 tracking-tighter leading-tight px-4">
                LA DESCARGA ELIMINA LOS DATOS ACTUALES Y BAJA TU COPIA DE SEGURIDAD.
              </p>
              <button 
                onClick={() => onCloudRestore(userName, backupPin)}
                disabled={isSyncing}
                className="w-full bg-slate-950 text-white p-6 rounded-[24px] font-black text-xs shadow-2xl hover:bg-black active:scale-95 transition-all flex items-center justify-center gap-3"
              >
                {isSyncing ? (
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <Download size={20} className="text-blue-400" />
                )}
                BAJAR DATOS DE LA NUBE
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button 
              onClick={onLogout}
              className="w-full bg-red-50 text-red-600 p-5 rounded-[24px] font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 hover:bg-red-600 hover:text-white transition-all active:scale-95 border-2 border-red-100"
            >
              <LogOut size={16} strokeWidth={3} />
              CERRAR SESIÓN / SALIR
            </button>
          </div>
        </div>
        
        {/* BOTÓN TELEGRAM FUERA DE LA CAJA */}
        <div className="flex justify-center mt-6">
          <a 
            href="https://t.me/CobroYa_1bot" 
            target="_blank" 
            rel="noopener noreferrer"
            className="w-12 h-12 bg-[#229ED9] text-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all"
          >
            <Send size={20} className="ml-0.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
function HistorySearchModal({ isOpen, onClose, clients, allPayments, allLoans }: { isOpen: boolean, onClose: () => void, clients: Client[], allPayments: Payment[], allLoans: Loan[] }) {
    const [query, setQuery] = useState('');
    
    const filteredClients = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      // Se cambia de includes a startsWith para mayor precisión según solicitud del usuario
      return clients.filter(c => c.name.toLowerCase().startsWith(q));
    }, [clients, query]);

    return (
      <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
        <motion.div 
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="bg-white w-full max-w-lg rounded-t-[40px] sm:rounded-[40px] p-6 max-h-[85vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-slate-950 uppercase tracking-tighter text-center flex-1 ml-8">Historial de Pagos</h3>
            <button onClick={onClose} className="p-2 text-slate-400 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"><X size={20} /></button>
          </div>

          <div className="relative mb-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              autoFocus
              type="text" 
              placeholder="Buscar por nombre del cliente..."
              className="w-full bg-slate-100 border-none rounded-2xl py-4 pl-12 pr-4 font-black text-slate-950 uppercase text-xs focus:ring-2 focus:ring-blue-600 outline-none placeholder:text-slate-300"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-4">
            {filteredClients.length > 0 ? (
              filteredClients.map(client => {
                // Find all loans for this client to get their payments
                const clientLoanIds = allLoans.filter(l => l.clientId === client.id).map(l => l.id);
                const clientPayments = allPayments
                  .filter(p => clientLoanIds.includes(p.loanId))
                  .sort((a, b) => {
                    const dateA = getValidDate(a.date).getTime();
                    const dateB = getValidDate(b.date).getTime();
                    return dateB - dateA;
                  });

                return (
                  <div key={client.id} className="bg-slate-50 rounded-[30px] p-6 border border-slate-100 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                      <div>
                        <p className="font-black text-slate-400 text-[9px] uppercase tracking-widest mb-0.5">Cliente</p>
                        <p className="font-black text-slate-950 uppercase text-sm tracking-tighter">{client.name}</p>
                        {client.address && (
                          <p className="text-[9px] font-black text-amber-600 uppercase tracking-tighter mt-1 flex items-center gap-1">
                            <MapPin size={10} strokeWidth={3} /> {client.address}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] font-black text-white bg-blue-600 px-3 py-1.5 rounded-full uppercase shadow-lg shadow-blue-100">
                        {clientPayments.length} PAGOS
                      </span>
                    </div>
                    
                    <div className="space-y-3 border-t border-slate-200/60 pt-4">
                      {clientPayments.length > 0 ? (
                        clientPayments.map(pay => (
                          <div key={pay.id} className="flex justify-between items-center text-[11px] font-bold py-1 group">
                            <div className="flex items-center gap-3">
                              <div className="w-2 h-2 rounded-full bg-green-500 shadow-sm shadow-green-200"></div>
                              <span className="text-slate-500 group-hover:text-slate-700 transition-colors">{safeFormatDate(pay.date, 'dd MMMM yyyy').toUpperCase()}</span>
                            </div>
                            <span className="text-slate-950 font-black tracking-tight bg-slate-100 px-2 py-1 rounded-lg">${pay.amount.toLocaleString()}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-4 bg-white/50 rounded-2xl border border-dashed border-slate-200">
                          <p className="text-[10px] text-slate-400 font-bold uppercase italic">No registra pagos aún</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : query ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                  <AlertCircle size={32} className="text-slate-300" />
                </div>
                <p className="text-slate-400 font-black uppercase text-xs">No se encontró al cliente "{query}"</p>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="w-20 h-20 bg-blue-50 text-blue-200 rounded-full flex items-center justify-center mx-auto mb-6">
                  <History size={40} strokeWidth={2.5} />
                </div>
                <p className="text-slate-400 font-black uppercase text-[10px] tracking-widest max-w-[200px] mx-auto leading-relaxed">
                  Ingresa el nombre de un cliente para ver todos sus abonos registrados.
                </p>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  function PersonalizedHelpModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
    const [helpTab, setHelpTab] = useState<'uso' | 'respaldo'>('uso');

    return (
      <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white w-full max-w-sm rounded-[40px] p-8 shadow-2xl relative overflow-y-auto max-h-[90vh]"
          onClick={e => e.stopPropagation()}
        >
          <button onClick={onClose} className="absolute top-6 right-6 text-slate-400 p-2 hover:bg-slate-50 rounded-full transition-colors">
            <X size={24} />
          </button>
          
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
              <HelpCircle size={32} strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-2xl font-black text-slate-950 leading-tight uppercase tracking-tighter">Guía Maestra</h3>
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-0.5">Control Total de tu Negocio</p>
            </div>
          </div>

          <div className="flex gap-2 mb-8 bg-slate-100 p-1 rounded-2xl">
            <button 
              onClick={() => setHelpTab('uso')}
              className={cn(
                "flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                helpTab === 'uso' ? "bg-white text-slate-900 shadow-sm" : "text-slate-400"
              )}
            >
              Uso General
            </button>
            <button 
              onClick={() => setHelpTab('respaldo')}
              className={cn(
                "flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                helpTab === 'respaldo' ? "bg-white text-slate-900 shadow-sm" : "text-slate-400"
              )}
            >
              Recuperación
            </button>
          </div>

          {helpTab === 'uso' ? (
            <div className="space-y-7">
              <div className="flex gap-5">
                <div className="w-9 h-9 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0 font-black text-blue-600 text-sm border border-blue-100 shadow-sm">1</div>
                <div className="space-y-1">
                  <p className="text-xs font-black text-slate-900 uppercase tracking-tight">Crea tus Clientes</p>
                  <p className="text-[11px] font-bold text-slate-500 uppercase leading-relaxed">Primero registra el nombre del cliente en el botón <span className="text-blue-600">+</span>. Sin cliente no hay préstamo.</p>
                </div>
              </div>
              <div className="flex gap-5">
                <div className="w-9 h-9 rounded-2xl bg-green-50 flex items-center justify-center shrink-0 font-black text-green-600 text-sm border border-green-100 shadow-sm">2</div>
                <div className="space-y-1">
                  <p className="text-xs font-black text-slate-900 uppercase tracking-tight">Controla los Cobros</p>
                  <p className="text-[11px] font-bold text-slate-500 uppercase leading-relaxed">En la pestaña <span className="text-green-600">COBROS</span> registra cuánto te pagaron hoy. Todo se suma al reporte final.</p>
                </div>
              </div>
              <div className="flex gap-5">
                <div className="w-9 h-9 rounded-2xl bg-amber-50 flex items-center justify-center shrink-0 font-black text-amber-600 text-sm border border-amber-100 shadow-sm">3</div>
                <div className="space-y-1">
                  <p className="text-xs font-black text-slate-900 uppercase tracking-tight">Seguridad Blindada</p>
                  <p className="text-[11px] font-bold text-slate-500 uppercase leading-relaxed">Tus datos se guardan <span className="text-amber-600">AUTOMÁTICAMENTE</span> en la nube al detectar cambios.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-3">
                <p className="text-xs font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                   <div className="w-2 h-2 bg-blue-600 rounded-full" />
                   ¿Cómo funciona?
                </p>
                <p className="text-[11px] font-medium text-slate-500 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  Arquitectura <b>Local-First</b>: Los datos viven en tu dispositivo (IndexedDB). Al <b>Recuperar</b>, el sistema solicita tu respaldo a Google, lo descarga en formato JSON y sobrescribe tu base local para restaurar todo al instante.
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                   <div className="w-2 h-2 bg-green-600 rounded-full" />
                   Lógica del Sistema
                </p>
                <div className="text-[10px] font-bold text-slate-500 uppercase leading-loose space-y-2">
                  <div className="flex gap-2"><span className="text-slate-950">1. VALIDACIÓN:</span> Verifica Nombre y PIN.</div>
                  <div className="flex gap-2"><span className="text-slate-950">2. PETICIÓN:</span> Solicitud GET segura a la nube.</div>
                  <div className="flex gap-2"><span className="text-slate-950">3. LIMPIEZA:</span> Borra datos actuales para evitar duplicados.</div>
                  <div className="flex gap-2"><span className="text-slate-950">4. TRANSFORMACIÓN:</span> Convierte texto a fechas reales.</div>
                  <div className="flex gap-2"><span className="text-slate-950">5. REFRESCO:</span> Reinicio automático para ver cambios.</div>
                </div>
              </div>

              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                <p className="text-[10px] font-black text-amber-800 uppercase tracking-tighter text-center">
                  Función clave: <b>handleCloudRestore</b>
                </p>
              </div>
            </div>
          )}

          <div className="mt-10 p-6 bg-slate-950 rounded-3xl text-center shadow-xl shadow-slate-200">
            <p className="text-[10px] text-slate-400 font-black uppercase mb-4 tracking-tighter">¿Problemas técnicos?</p>
            <a 
              href="https://t.me/CobroYa_1bot" 
              target="_blank" 
              rel="noreferrer"
              className="w-full bg-blue-600 text-white py-4 rounded-xl font-black text-xs uppercase flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-blue-700 shadow-lg shadow-blue-900/20"
            >
              Contactar Soporte en Telegram
            </a>
          </div>
        </motion.div>
      </div>
    );
  }

// --- Sub-components ---

function BlockedScreen({ userName, backupPin, type }: { userName: string, backupPin: string, type: 'blocked' | 'expired' }) {
  return (
    <div className="fixed inset-0 bg-slate-950 z-[100] flex items-center justify-center p-6 text-center">
      <div className="max-w-xs w-full space-y-8">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="mx-auto w-24 h-24 bg-red-600 rounded-[40px] flex items-center justify-center shadow-2xl shadow-red-900/20 animate-pulse"
        >
           <AlertCircle size={48} className="text-white" />
        </motion.div>
        
        <div className="space-y-3">
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic">
            {type === 'expired' ? 'Suscripción Vencida' : 'Acceso Restringido'}
          </h2>
          <p className="text-slate-400 text-sm font-bold">
            Es necesario renovar tu acceso para continuar usando Cobroya.
          </p>
        </div>

        <div className="bg-slate-900 rounded-3xl p-6 border-2 border-slate-800 space-y-4">
          <div className="text-left space-y-1">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Identificador de Usuario</p>
            <p className="text-lg font-black text-white uppercase tracking-tighter bg-slate-950 px-4 py-3 rounded-2xl border border-slate-800">{userName || 'SIN REGISTRO'}</p>
          </div>
          <div className="text-left space-y-1">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">PIN de Acceso</p>
            <p className="text-lg font-black text-white uppercase tracking-tighter bg-slate-950 px-4 py-3 rounded-2xl border border-slate-800">{backupPin || 'SIN CLAVE'}</p>
          </div>
        </div>

        <div className="space-y-4">
          <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.2em]">Contacta al Administrador</p>
          <a 
            href="https://t.me/CobroYa_1bot" 
            target="_blank"
            rel="no-referrer"
            className="flex items-center justify-center gap-3 w-full py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-3xl font-black text-lg shadow-xl shadow-blue-900/20 transition-all active:scale-95"
          >
             ABRIR TELEGRAM BOT
          </a>
          <p className="text-slate-600 text-[10px] font-bold uppercase">Cobroya @CobroYa_1bot</p>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, count }: { title: string, count?: number }) {
  return (
    <div className="flex items-center justify-between mb-3 px-1">
      <h2 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.15em] border-l-4 border-blue-600 pl-2">{title}</h2>
      {count !== undefined && (
        <span className="bg-slate-900 text-white text-[10px] font-black px-3 py-1 rounded-full">{count}</span>
      )}
    </div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode, message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-6">
      <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center text-slate-300 border-4 border-slate-200 shadow-inner">
        {React.cloneElement(icon as React.ReactElement, { size: 48, strokeWidth: 2 })}
      </div>
      <p className="text-slate-500 font-black text-lg tracking-tight px-8">{message}</p>
    </div>
  );
}

interface LoanCardProps {
  loan: Loan;
  client?: Client | undefined;
  payments: Payment[];
  onPay: () => void;
  showPayButton?: boolean;
  showDetails?: boolean;
}

const LoanCard: React.FC<LoanCardProps> = ({ 
  loan, 
  client, 
  payments, 
  onPay, 
  showPayButton = false,
  showDetails = false
}) => {
  const status = getLoanStatus(loan, payments);
  const { totalPaid, installmentsPaid, percentage } = getInstallmentsInfo(loan, payments);

  const statusColors = {
    green: "bg-green-600",
    yellow: "bg-yellow-500",
    red: "bg-red-600",
    expired: "bg-slate-950",
    completed: "bg-blue-600"
  };

  const statusBg = {
    green: "bg-green-50/50 border-green-200",
    yellow: "bg-yellow-50/50 border-yellow-200",
    red: "bg-red-50/50 border-red-200",
    expired: "bg-slate-50 border-slate-300",
    completed: "bg-blue-50/50 border-blue-200"
  };

  const statusLabel = {
    green: "Al día",
    yellow: "Atraso leve",
    red: "Atraso crítico",
    expired: "Vencido",
    completed: "Finalizado"
  };

  return (
    <div className={cn("bg-white rounded-[32px] shadow-xl border-4 overflow-hidden transition-all duration-300", statusBg[status as keyof typeof statusBg])}>
      <div className="p-6">
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-4">
            <div className={cn("w-3 h-14 rounded-full", statusColors[status as keyof typeof statusColors])}></div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-black text-slate-950 text-xl leading-none">{client?.name}</p>
                {isToday(loan.createdAt) && loan.note === 'RENOVACIÓN' && (
                  <span className="bg-amber-100 text-amber-700 text-[8px] font-black px-2 py-0.5 rounded-full border border-amber-200 uppercase tracking-tighter shadow-sm animate-pulse">
                    DESCUENTO
                  </span>
                )}
              </div>
              <span className={cn("text-[10px] font-black uppercase tracking-widest mt-1 inline-block", statusColors[status as keyof typeof statusColors].replace('bg-', 'text-'))}>
                {statusLabel[status as keyof typeof statusLabel]}
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500 font-black uppercase tracking-tighter">Diario</p>
            <p className="text-2xl font-black text-slate-950 leading-none">${Math.round(loan.dailyPayment)}</p>
          </div>
        </div>

        {/* Progress Bar Container */}
        <div className="bg-white p-5 rounded-[24px] border-2 border-slate-200 box-shadow-app">
          <div className="flex justify-between text-[11px] font-black text-slate-950 mb-2 uppercase tracking-tighter">
            <span>Progreso de cuotas</span>
            <span className="bg-slate-900 text-white px-2 py-0.5 rounded-lg">{installmentsPaid} / {loan.days}</span>
          </div>
          <div className="h-4 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${percentage}%` }}
              className={cn("h-full transition-all duration-1000", statusColors[status as keyof typeof statusColors])} 
            />
          </div>
          <div className="flex justify-between mt-3">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 font-extrabold uppercase">Cobrado</span>
              <span className="text-sm font-black text-slate-950">${Math.round(totalPaid)}</span>
            </div>
            <div className="flex flex-col text-right">
              <span className="text-[10px] text-slate-500 font-extrabold uppercase">Total Pactado</span>
              <span className="text-sm font-black text-slate-950">${Math.round(loan.totalToPay)}</span>
            </div>
          </div>
        </div>

        {showDetails && (
          <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t-2 border-slate-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 rounded-xl text-slate-900">
                <Calendar size={18} strokeWidth={3} />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest leading-none">Inicio</p>
                <p className="text-xs font-black text-slate-950 mt-1">{format(loan.startDate, 'dd/MM/yyyy')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 rounded-xl text-slate-900">
                <Calendar size={18} strokeWidth={3} />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest leading-none">Fin</p>
                <p className="text-xs font-black text-slate-950 mt-1">{format(loan.endDate, 'dd/MM/yyyy')}</p>
              </div>
            </div>
          </div>
        )}

        {showPayButton && (
          <button 
            onClick={onPay}
            className="w-full mt-6 py-5 bg-blue-600 text-white rounded-[24px] font-black text-lg flex items-center justify-center gap-3 active:scale-[0.96] transition-all shadow-xl shadow-blue-200"
          >
            <CheckCircle size={24} strokeWidth={3} />
            <span>RECIBIR PAGO</span>
          </button>
        )}
      </div>
      {(status === 'red' || status === 'expired') && (
        <div className="bg-red-600 px-6 py-3 flex items-center gap-3 text-white">
          <AlertCircle size={20} strokeWidth={3} />
          <span className="text-xs font-black uppercase tracking-widest">COBRO URGENTE</span>
        </div>
      )}
    </div>
  );
};

// --- Modals ---

function AddClientModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [identity, setIdentity] = useState('');
  const [address, setAddress] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    await db.clients.add({ 
      name, 
      phone, 
      identity,
      address,
      createdAt: new Date() 
    });
    setName('');
    setPhone('');
    setIdentity('');
    setAddress('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-sm rounded-[40px] p-8 shadow-2xl border-4 border-slate-100"
      >
        <h3 className="text-2xl font-black text-slate-950 mb-8 tracking-tighter">Nuevo Cliente</h3>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-950 uppercase tracking-widest ml-1">Nombre Completo</label>
            <input 
              required
              type="text" 
              className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-200 rounded-3xl focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 font-black text-slate-950 outline-none transition-all"
              placeholder="Ej: Juan Perez"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-black text-slate-950 uppercase tracking-widest ml-1">Teléfono</label>
              <input 
                type="tel" 
                inputMode="numeric"
                pattern="[0-9]*"
                className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-200 rounded-3xl focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 font-black text-slate-950 outline-none transition-all"
                placeholder="Opcional"
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-black text-slate-950 uppercase tracking-widest ml-1">Identidad</label>
              <input 
                type="tel" 
                inputMode="numeric"
                pattern="[0-9]*"
                className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-200 rounded-3xl focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 font-black text-slate-950 outline-none transition-all"
                placeholder="Opcional ID"
                value={identity}
                onChange={e => setIdentity(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-950 uppercase tracking-widest ml-1">Ubicación / Dirección</label>
            <input 
              type="text" 
              className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-200 rounded-3xl focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 font-black text-slate-950 outline-none transition-all"
              placeholder="Ej: Calle Principal #123"
              value={address}
              onChange={e => setAddress(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-3 pt-4">
            <button 
              type="submit"
              className="w-full py-5 bg-blue-600 text-white rounded-3xl font-black text-lg shadow-xl shadow-blue-200 active:scale-95 transition-all"
            >
              REGISTRAR CLIENTE
            </button>
            <button 
              type="button"
              onClick={onClose}
              className="w-full py-4 font-black text-slate-500 text-sm uppercase tracking-widest"
            >
              CANCELAR
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }: { isOpen: boolean, title: string, message: string, onConfirm: () => void, onCancel: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-xs rounded-[40px] p-8 shadow-2xl text-center border-4 border-slate-100"
      >
        <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Trash2 size={40} strokeWidth={2.5} />
        </div>
        <h3 className="text-xl font-black text-slate-950 mb-3 tracking-tighter">{title}</h3>
        <p className="text-xs font-bold text-slate-500 mb-8 leading-relaxed px-2">{message}</p>
        <div className="flex flex-col gap-3">
          <button 
            onClick={onConfirm}
            className="w-full py-5 bg-red-600 text-white rounded-3xl font-black text-base shadow-xl shadow-red-100 active:scale-95 transition-all"
          >
            SÍ, ELIMINAR
          </button>
          <button 
            onClick={onCancel}
            className="w-full py-3 text-slate-400 font-black text-xs uppercase tracking-widest"
          >
            CANCELAR
          </button>
        </div>
      </motion.div>
    </div>
  );
}
function AddLoanModal({ 
  isOpen, 
  onClose, 
  clients, 
  activeLoans,
  allPayments,
  allLoans
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  clients: Client[], 
  activeLoans: Loan[],
  allPayments: Payment[],
  allLoans: Loan[]
}) {
  const [clientId, setClientId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [days, setDays] = useState<string>('20');
  const [interest, setInterest] = useState<string>('20');

  // Filtrar clientes que NO tengan un préstamo activo
  const eligibleClients = useMemo(() => {
    const activeClientIds = new Set(activeLoans.map(l => l.clientId));
    return clients.filter(c => !activeClientIds.has(c.id!));
  }, [clients, activeLoans]);

  const { totalToPay, dailyPayment } = useMemo(() => {
    return calculateLoanTotals(Number(amount) || 0, Number(interest) || 0, Number(days) || 1);
  }, [amount, interest, days]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || !amount) return;

    // DETECTAR RENOVACIÓN
    // Buscamos si existe un pago marcado como 'DESCUENTO' hoy para este cliente
    const todayRenovations = allPayments.filter(p => 
      isToday(p.date) && p.note === 'DESCUENTO'
    );
    
    const isRenovation = todayRenovations.some(p => {
      const relatedLoan = allLoans.find(l => l.id === p.loanId);
      return relatedLoan?.clientId === Number(clientId);
    });

    const startDate = new Date();
    await db.loans.add({
      clientId: Number(clientId),
      amount: Number(amount),
      days: Number(days),
      interestRate: Number(interest),
      totalToPay,
      dailyPayment,
      status: 'active',
      startDate,
      endDate: addDays(startDate, Number(days)),
      createdAt: new Date(),
      note: isRenovation ? 'RENOVACIÓN' : undefined
    });
    
    setClientId('');
    setAmount('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-white w-full max-w-sm rounded-[40px] p-8 shadow-2xl border-4 border-slate-100 overflow-y-auto max-h-[90vh]"
      >
        <h3 className="text-2xl font-black text-slate-950 mb-8 tracking-tighter">Nuevo Préstamo</h3>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-950 uppercase tracking-widest ml-1">Cliente</label>
            <select 
              className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-200 rounded-3xl font-black text-slate-950 outline-none appearance-none"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
            >
              <option value="">Elegir uno...</option>
              {eligibleClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {eligibleClients.length === 0 && clients.length > 0 && (
              <p className="text-[11px] text-red-600 font-black mt-1 ml-2">Todos tienen deudas activas.</p>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-black text-slate-950 uppercase tracking-widest ml-1">Capital</label>
              <input 
                required
                type="number" 
                className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-200 rounded-3xl font-black text-slate-950 outline-none"
                placeholder="1000"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-black text-slate-950 uppercase tracking-widest ml-1">% Interés</label>
              <input 
                type="number" 
                className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-200 rounded-3xl font-black text-slate-950 outline-none"
                value={interest}
                onChange={e => setInterest(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-950 uppercase tracking-widest ml-1">Días de plazo</label>
            <input 
              type="number" 
              className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-200 rounded-3xl font-black text-slate-950 outline-none"
              value={days}
              onChange={e => setDays(e.target.value)}
            />
          </div>

          <div className="bg-slate-950 p-6 rounded-3xl space-y-3 mt-4 border-2 border-slate-800">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-bold uppercase text-[10px] tracking-widest">A pagar:</span>
              <span className="font-black text-blue-400 text-xl">${Math.round(totalToPay)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-bold uppercase text-[10px] tracking-widest">Cuota:</span>
              <span className="font-black text-white text-xl">${Math.round(dailyPayment)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <button 
              type="submit"
              className="w-full py-5 bg-blue-600 text-white rounded-3xl font-black text-lg shadow-xl shadow-blue-200 active:scale-95 transition-all"
            >
              CREAR PRÉSTAMO
            </button>
            <button 
              type="button"
              onClick={onClose}
              className="w-full py-4 font-black text-slate-500 text-sm uppercase tracking-widest"
            >
              CANCELAR
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
