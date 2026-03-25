/* src/components/BillDetailModal.tsx */
/* Cleaned, fixed, and optimistic version of your original file.
   - All original imports preserved.
   - Syntax/logic fixes applied.
   - Keep backups of your previous file before replacing.
*/

import React, { useState, useEffect } from 'react';
import type { Bill, Vegetable, BillItem } from '../../types/types';
import { XMarkIcon, EyeIcon, ArrowDownTrayIcon, ShareIcon } from './ui/Icon.tsx';
import ImagePreviewModal from './ui/ImagePreviewModal.tsx';
import Button from './ui/Button.tsx';
import { getVegetableById, getDateKey } from '../services/dbService';
import qrImg from '../assets/QR.jpeg';
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

// Firestore imports
import { doc, getDoc, writeBatch, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase.ts';

// New import: html2canvas for emoji fallback raster rendering
import html2canvas from 'html2canvas';

// Import reservation logic for orderable stock calculation
import { getOrderableStock, ORDERABLE_STOCK_PERCENTAGE, RESERVED_STOCK_PERCENTAGE } from '../../constants';

// IMPORTANT: External js font file generated via jsPDF fontconverter.
// Put your generated file at src/fonts/NotoSansTamil-Regular.js
// That file should call jsPDF.API.events.push([...]) and add the font to VFS
import '../fonts/NotoSansTamil-Regular.js';

// Let TypeScript know that jspdf is available on the window object
declare global {
  interface Window {
    jspdf: any;
  }
}

type ExtendedBill = Bill & { employee_name?: string };

// UPI ID configuration (single fixed ID)
const UPI_IDS = [
  {
    id: 'paytm.s1xteyq@pty',
    name: 'R Bakialakshmi',
    displayName: 'paytm.s1xteyq@pty'
  }
];

interface BillDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  bill: Bill | null;
  vegetableMap: Map<string, Vegetable>;
  vegetables: Vegetable[]; // Add vegetables array for adding new items
  onUpdateBill?: (billId: string, updates: Partial<Bill>) => Promise<void>;
  currentUser?: { id: string; name: string; role: string; email?: string };
}

// Small helper: safe JSON stringify for logs
const safeString = (v: any) => {
  try { return JSON.stringify(v); } catch { return String(v); }
};

// Sanitize: remove emojis, variation selectors, zero-width joiner, but keep Tamil letters and common punctuation.
// This preserves Tamil text while ensuring emojis are stripped (user requested no emojis).
const sanitizeTextForPdf = (input: string | undefined | null): string => {
  if (!input) return '';
  // Remove emoji presentation/extended pictographic (Unicode property), fallback to surrogate pair heuristic
  try {
    // Remove emoji and symbol presentation characters
    const withoutEmoji = input.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
    // Remove variation selectors and ZERO WIDTH JOINER
    return withoutEmoji
      .replace(/\uFE0F/g, '')
      .replace(/\u200D/g, '')
      // Remove private use characters
      .replace(/[\uE000-\uF8FF]/g, '')
      // Collapse whitespace
      .replace(/\s{2,}/g, ' ')
      .trim();
  } catch (e) {
    // Fallback: strip surrogate pairs likely representing emojis
    return input
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/\uFE0F/g, '')
      .replace(/\u200D/g, '')
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
};

// Emoji detection util (returns true if text contains emoji-like characters)
const containsEmoji = (text: string | undefined | null): boolean => {
  if (!text) return false;
  try {
    return /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(text);
  } catch (e) {
    // fallback surrogate check
    return /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text);
  }
};

const BillDetailModal: React.FC<BillDetailModalProps> = ({
  isOpen,
  onClose,
  bill,
  vegetableMap,
  vegetables,
  onUpdateBill,
  currentUser
}) => {
  const billTyped = bill as ExtendedBill | null;

  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [editedItems, setEditedItems] = useState<BillItem[]>([]);
  const [itemChecks, setItemChecks] = useState<Record<string, boolean>>({});
  const [calculatedTotal, setCalculatedTotal] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [showAddVegetables, setShowAddVegetables] = useState(false);
  const [customerNameFromDB, setCustomerNameFromDB] = useState<string>('');
  const [fetchedVegetables, setFetchedVegetables] = useState<Map<string, Vegetable>>(new Map());
  const [isLoadingVegetables, setIsLoadingVegetables] = useState(false);
  const globalVegetableCache = React.useRef<Map<string, Vegetable>>(new Map());
  const [selectedUpiId, setSelectedUpiId] = useState<string>(UPI_IDS[0]?.id || '');
  // New: department fetched from DB for accurate file naming and header printing
  const [customerDeptFromDB, setCustomerDeptFromDB] = useState<string>('');
  // Stock validation states
  const [availableStockMap, setAvailableStockMap] = useState<Map<string, number>>(new Map());
  const [stockAlert, setStockAlert] = useState<{ show: boolean; itemName: string; requested: number; available: number } | null>(null);

  // Helper function to calculate effective available stock for admin during bill editing
  // For admin editing: availableStock (from DB) + original bill quantity = total accessible stock
  // This is because the original order quantity was already deducted from DB stock
  const getEffectiveAvailableStock = (vegetableId: string): number => {
    const dbStock = availableStockMap.get(vegetableId) || 0;
    const originalItem = bill?.items.find(item => item.vegetableId === vegetableId);
    const originalQty = originalItem?.quantityKg || 0;
    const effectiveStock = dbStock + originalQty;
    
    
    return effectiveStock;
  };

  useEffect(() => {
    if (bill) {
      const itemsCopy = bill.items ? [...bill.items] : [];
      setEditedItems(itemsCopy);
      const checks: Record<string, boolean> = {};
      itemsCopy.forEach((it, idx) => {
        const key = `${it.vegetableId}::${idx}`;
        checks[key] = itemChecks[key] || false;
      });
      setItemChecks(checks);
      setCalculatedTotal(bill.total || 0);
      setHasUnsavedChanges(false);
      setFetchedVegetables(new Map());
      setSelectedUpiId(UPI_IDS[0]?.id || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill?.id]);

  const combinedVegetableMap = React.useMemo(() => {
    const combined = new Map(vegetableMap);
    fetchedVegetables.forEach((veg, id) => combined.set(id, veg));
    return combined;
  }, [vegetableMap, fetchedVegetables]);

  // Fetch missing vegetables in batch (optimized)
  useEffect(() => {
    if (!bill) return;
    let mounted = true;
    const fetchMissing = async () => {
      setIsLoadingVegetables(true);
      try {
        const missingIds = bill.items
          .map(it => it.vegetableId)
          .filter(id => !vegetableMap.has(id) && !fetchedVegetables.has(id) && !globalVegetableCache.current.has(id));

        const newMap = new Map<string, Vegetable>();
        for (const vegId of missingIds) {
          let vegetableData = await getVegetableById(vegId);
          if (!vegetableData) {
            const dateKey = getDateKey(new Date(bill.date));
            const snap = await getDoc(doc(db, 'vegetables', dateKey, 'items', vegId));
            if (snap.exists()) {
              const data = snap.data() as any;
              vegetableData = {
                id: snap.id,
                name: data.name || `Item ${vegId}`,
                unitType: (data.unitType as 'KG' | 'COUNT') || 'KG',
                pricePerKg: Number(data.pricePerKg ?? data.price ?? 0),
                totalStockKg: Number(data.totalStockKg ?? 0),
                stockKg: Number(data.stockKg ?? 0),
                category: (data.category as string) || 'General'
              };
            }
          }
          if (vegetableData) {
            newMap.set(vegId, vegetableData);
            globalVegetableCache.current.set(vegId, vegetableData);
          }
        }
        if (mounted && newMap.size > 0) setFetchedVegetables(prev => new Map([...prev, ...newMap]));
      } catch (err) {
        console.error('Batch veg fetch failed', err);
      } finally {
        if (mounted) setIsLoadingVegetables(false);
      }
    };
    fetchMissing();
    return () => { mounted = false; };
  }, [bill?.id, vegetableMap]);

  // Recalculate totals
  useEffect(() => {
    const itemsTotal = editedItems.reduce((s, it) => s + (it.subtotal || 0), 0);
    setCalculatedTotal(itemsTotal);

    if (bill) {
      // Check for changes by comparing items by vegetableId, not by index
      const originalItemsTotal = bill.items.reduce((s, it) => s + (it.subtotal || 0), 0);
      
      // Check if total changed
      if (itemsTotal !== originalItemsTotal) {
        setHasUnsavedChanges(true);
        return;
      }
      
      // Check if number of items changed
      if (editedItems.length !== bill.items.length) {
        setHasUnsavedChanges(true);
        return;
      }
      
      // Create maps for comparison by vegetableId
      const originalMap = new Map(bill.items.map(item => [item.vegetableId, item]));
      const editedMap = new Map(editedItems.map(item => [item.vegetableId, item]));
      
      // Check if any items were added or removed
      const originalIds = new Set(bill.items.map(it => it.vegetableId));
      const editedIds = new Set(editedItems.map(it => it.vegetableId));
      
      const hasAddedOrRemoved = originalIds.size !== editedIds.size || 
        [...originalIds].some(id => !editedIds.has(id)) ||
        [...editedIds].some(id => !originalIds.has(id));
      
      if (hasAddedOrRemoved) {
        setHasUnsavedChanges(true);
        return;
      }
      
      // Check if any quantities or subtotals changed
      const hasQuantityOrPriceChanges = editedItems.some(item => {
        const original = originalMap.get(item.vegetableId);
        return !original || 
          item.quantityKg !== original.quantityKg || 
          item.subtotal !== original.subtotal;
      });
      
      setHasUnsavedChanges(hasQuantityOrPriceChanges);
    }
  }, [editedItems, bill]);

  // Get customer key helper
  const getCustomerKeyFromBill = (b: Bill): string | null => {
    const anyBill = b as any;
    if ('customerId' in anyBill && typeof anyBill.customerId === 'string' && anyBill.customerId.trim()) return anyBill.customerId;
    if ('customerUid' in anyBill && typeof anyBill.customerUid === 'string' && anyBill.customerUid.trim()) return anyBill.customerUid;
    if ('customerEmail' in anyBill && typeof anyBill.customerEmail === 'string' && anyBill.customerEmail.trim()) return (anyBill.customerEmail as string).split('@')[0];
    if ('customerPhone' in anyBill && typeof anyBill.customerPhone === 'string' && anyBill.customerPhone.trim()) return anyBill.customerPhone;
    if ('userId' in anyBill && typeof anyBill.userId === 'string' && anyBill.userId.trim()) return anyBill.userId;
    if ('createdBy' in anyBill && typeof anyBill.createdBy === 'string' && anyBill.createdBy.trim()) return anyBill.createdBy;
    return null;
  };

  // Fetch available stock for all vegetables
  useEffect(() => {
    if (!bill) return;
    let mounted = true;
    const fetchAvailableStock = async () => {
      try {
        const dateKey = getDateKey(new Date(bill.date));
        const availStockCol = collection(db, 'availableStock', dateKey, 'items');
        const snapshot = await getDocs(availStockCol);
        const stockMap = new Map<string, number>();
        snapshot.forEach(doc => {
          const data = doc.data();
          stockMap.set(doc.id, Number(data.availableStockKg || 0));
        });
        if (mounted) setAvailableStockMap(stockMap);
      } catch (err) {
        console.error('Error fetching available stock:', err);
      }
    };
    fetchAvailableStock();
    return () => { mounted = false; };
  }, [bill?.id]);

  // Fetch customer name and department from DB
  useEffect(() => {
    if (!bill) return;
    let mounted = true;
    const loadName = async () => {
      setCustomerNameFromDB('');
      setCustomerDeptFromDB('');
      const key = getCustomerKeyFromBill(bill);
      if (!key) return;
      try {
        const userRef = doc(db, 'users', key);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists() && mounted) {
          const data = userSnap.data() as any;
          setCustomerNameFromDB(data.employee_name || data.name || data.fullName || data.displayName || '');
          const dept =
            data.department ||
            data.dept ||
            data.departmentName ||
            data.employee?.department ||
            '';
          setCustomerDeptFromDB(typeof dept === 'string' ? dept : '');
          return;
        }
        const custRef = doc(db, 'customers', key);
        const custSnap = await getDoc(custRef);
        if (custSnap.exists() && mounted) {
          const data = custSnap.data() as any;
          setCustomerNameFromDB(data.employee_name || data.name || data.fullName || data.displayName || '');
          const dept =
            data.department ||
            data.dept ||
            data.departmentName ||
            data.employee?.department ||
            '';
          setCustomerDeptFromDB(typeof dept === 'string' ? dept : '');
          return;
        }
      } catch (err) {
        console.error('Error loading customer name', err);
      }
      if (mounted) {
        setCustomerNameFromDB('');
        setCustomerDeptFromDB('');
      }
    };
    loadName();
    return () => { mounted = false; };
  }, [bill?.id]);

  if (!isOpen || !bill) return null;

  const handleQuantityChange = (index: number, newQuantity: number) => {
    const current = editedItems[index];
    if (!current) return;
    const veg = combinedVegetableMap.get(current.vegetableId);
    
    
    // For COUNT items, ensure integer values; for KG items, allow decimals
    let clamped: number;
    if (veg?.unitType === 'COUNT') {
      clamped = Math.max(0, Math.floor(newQuantity)); // Integer only for count
    } else {
      clamped = Math.max(0, Math.round(newQuantity * 100) / 100); // Decimal for kg
    }
    
    
    // Check available stock - strict validation against current DB stock
    const availableStock = availableStockMap.get(current.vegetableId) || 0;
    
    // Get the ORIGINAL quantity from the bill (not the edited quantity)
    // This is crucial because the DB stock already has the original order deducted
    const originalItem = bill?.items.find(item => item.vegetableId === current.vegetableId);
    const originalQty = originalItem?.quantityKg || 0;
    
    // Calculate quantity used by OTHER items in the edited bill with the same vegetableId (excluding current item)
    const otherItemsQty = editedItems
      .filter((_, idx) => idx !== index && _.vegetableId === current.vegetableId)
      .reduce((sum, item) => sum + item.quantityKg, 0);
    
    // Max allowed = available in DB + original bill quantity - what other edited items are using
    // The original quantity was already deducted from stock when order was placed,
    // so we add it back to get the true available amount for this bill
    const maxAllowed = availableStock + originalQty - otherItemsQty;
    
    if (clamped > maxAllowed) {
      setStockAlert({
        show: true,
        itemName: veg?.name || `Item ${current.vegetableId}`,
        requested: clamped,
        available: Math.max(0, maxAllowed)
      });
      setTimeout(() => setStockAlert(null), 5000);
      clamped = Math.max(0, maxAllowed);
    }
    
    const pricePerKg = veg ? veg.pricePerKg : (current.quantityKg ? current.subtotal / current.quantityKg : 0);
    const newSubtotal = Math.round(clamped * pricePerKg * 100) / 100;
    const copy = [...editedItems];
    copy[index] = { ...copy[index], quantityKg: clamped, subtotal: newSubtotal, pricePerKg };
    setEditedItems(copy);
  };

  const handleAddVegetable = (vegetableId: string, quantity: number) => {
    const veg = combinedVegetableMap.get(vegetableId);
    if (!veg || quantity <= 0) return;
    
    
    // Ensure correct quantity format based on unit type
    let adjustedQty = quantity;
    if (veg.unitType === 'COUNT') {
      adjustedQty = Math.floor(quantity); // Integer only for count
    }
    
    // Check available stock - strict validation against current DB stock
    const availableStock = availableStockMap.get(vegetableId) || 0;
    
    // Get the ORIGINAL quantity from the bill for this vegetableId
    const originalItem = bill?.items.find(item => item.vegetableId === vegetableId);
    const originalQty = originalItem?.quantityKg || 0;
    
    // Calculate quantity currently in edited items for this vegetableId
    const currentEditedQty = editedItems
      .filter(it => it.vegetableId === vegetableId)
      .reduce((sum, item) => sum + item.quantityKg, 0);
    
    // Max allowed = available in DB + original bill quantity - what's currently in edited items
    const maxAllowed = availableStock + originalQty - currentEditedQty;
    
    if (adjustedQty > maxAllowed) {
      setStockAlert({
        show: true,
        itemName: veg.name,
        requested: adjustedQty,
        available: Math.max(0, maxAllowed)
      });
      setTimeout(() => setStockAlert(null), 5000);
      if (maxAllowed <= 0) {
        return; // Don't add if no stock available
      }
      adjustedQty = maxAllowed; // Adjust to max allowed
    }
    
    const idx = editedItems.findIndex(it => it.vegetableId === vegetableId);
    if (idx >= 0) {
      const copy = [...editedItems];
      const newQty = copy[idx].quantityKg + adjustedQty;
      copy[idx] = { ...copy[idx], quantityKg: newQty, subtotal: newQty * veg.pricePerKg, pricePerKg: veg.pricePerKg };
      setEditedItems(copy);
    } else {
      const ni: BillItem = { vegetableId, quantityKg: adjustedQty, subtotal: adjustedQty * veg.pricePerKg, pricePerKg: veg.pricePerKg };
      setEditedItems(prev => [...prev, ni]);
    }
  };

  const handleRemoveVegetable = (vegetableId: string) => {
    setEditedItems(prev => prev.filter(it => it.vegetableId !== vegetableId));
  };

  const getAvailableVegetables = () => {
    return vegetables.filter(v => !editedItems.some(it => it.vegetableId === v.id));
  };

  const updateStockForQuantityChanges = async () => {
    try {
      const stockBatch = writeBatch(db);
      let stockUpdateCount = 0;
      const targetDate = new Date(bill.date);
      const dateKey = getDateKey(targetDate);

      const originalMap = new Map<string, number>();
      bill.items.forEach(it => originalMap.set(it.vegetableId, it.quantityKg));
      const editedMap = new Map<string, number>();
      editedItems.forEach(it => editedMap.set(it.vegetableId, it.quantityKg));

      const allIds = new Set([...originalMap.keys(), ...editedMap.keys()]);

      for (const vegId of allIds) {
        const originalQty = originalMap.get(vegId) || 0;
        const editedQty = editedMap.get(vegId) || 0;
        const diff = editedQty - originalQty;
        if (diff === 0) continue;

        // veg collection update
        const vegRef = doc(db, 'vegetables', dateKey, 'items', vegId);
        const vegSnap = await getDoc(vegRef);
        if (vegSnap.exists()) {
          const currentStock = Number(vegSnap.data().stockKg || 0);
          const newStock = diff > 0 ? Math.max(0, currentStock - diff) : currentStock + Math.abs(diff);
          stockBatch.update(vegRef, { stockKg: newStock, updatedAt: serverTimestamp() });
          stockUpdateCount++;
        } else {
          console.warn('Vegetable doc missing:', vegId);
        }

        // availableStock collection update
        const availRef = doc(db, 'availableStock', dateKey, 'items', vegId);
        const availSnap = await getDoc(availRef);
        if (availSnap.exists()) {
          const currentAvail = Number(availSnap.data().availableStockKg || 0);
          const newAvail = diff > 0 ? Math.max(0, currentAvail - diff) : currentAvail + Math.abs(diff);
          stockBatch.update(availRef, { availableStockKg: newAvail, lastUpdated: serverTimestamp(), updatedBy: currentUser?.id || 'admin' });
          stockUpdateCount++;
        } else {
          console.warn('Available stock doc missing for:', vegId);
        }
      }

      if (stockUpdateCount > 0) {
        await stockBatch.commit();
      } else {
      }
    } catch (err) {
      console.error('Stock update failed', err);
    }
  };

  const handleSaveChanges = async () => {
    if (!onUpdateBill || !bill || !hasUnsavedChanges) return;
    setIsSaving(true);
    try {
      await updateStockForQuantityChanges();
      await onUpdateBill(bill.id, { items: editedItems, total: calculatedTotal });
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('Save failed', err);
      alert('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // ---------------- PDF Generation helpers ----------------

  // Try to set NotoSansTamil in jsPDF if available (imported file should have registered it).
  const trySetNotoInPdf = (pdfDoc: any) => {
    try {
      pdfDoc.setFont('NotoSansTamil');
      return true;
    } catch (e) {
      console.warn('NotoSansTamil not registered in jsPDF VFS, falling back to helvetica');
      try {
        pdfDoc.setFont('helvetica');
      } catch { /* ignore */ }
      return false;
    }
  };

  // Create printable DOM element for raster fallback
  const createPrintableBillElement = async (): Promise<HTMLElement> => {
    const container = document.createElement('div');
    container.style.width = '794px';
    container.style.padding = '18px';
    container.style.boxSizing = 'border-box';
    container.style.background = '#fff';
    container.style.color = '#111827';
    container.style.fontFamily = "'Noto Sans Tamil', 'Roboto', Arial, sans-serif";
    container.style.fontSize = '12px';
    container.style.lineHeight = '1.35';

    // Header (neutral, no green background)
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.padding = '12px';
    header.style.borderRadius = '8px';
    header.style.background = 'transparent';
    header.style.border = '1px solid #e5e7eb';
    header.style.color = '#111827';
    header.innerHTML = `<div style="font-weight:800;font-size:20px;color:#111827">Engal Santhai</div><div style="font-size:12px;color:#475569;margin-top:4px">Your Fresh Vegetable Partner</div><div style="font-weight:700;color:#111827">INVOICE</div>`;
    container.appendChild(header);

    // Meta
  const meta = document.createElement('div');
    meta.style.display = 'flex';
    meta.style.justifyContent = 'space-between';
    meta.style.marginTop = '12px';
    const billDateObj = new Date(bill.date);
    const dd = String(billDateObj.getDate()).padStart(2, '0');
    const mm = String(billDateObj.getMonth() + 1).padStart(2, '0');
    const yyyy = billDateObj.getFullYear();
    const idMatch = bill.id.match(/(\d{3,})$/);
    let serial = '001';
    if (idMatch) serial = idMatch[1].slice(-3).padStart(3, '0');
    const billNoFormatted = `ES${dd}${mm}${yyyy}-${serial}`;
    const deptForHtml = sanitizeTextForPdf(customerDeptFromDB || (bill as any).department || 'NA').toUpperCase();
    meta.innerHTML = `<div style="font-weight:600">BILL NO: ${billNoFormatted}<div style="margin-top:6px">Date: ${dd}/${mm}/${yyyy}</div></div>
      <div style="text-align:right">${sanitizeTextForPdf(customerNameFromDB || bill.customerName || '')}
        <div style="margin-top:6px">EMP ID: ${(bill.customerId || bill.customerName || 'N/A')}</div>
        <div style="margin-top:6px">DEPT: ${deptForHtml}</div>
      </div>`;
    container.appendChild(meta);

    // Table
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.marginTop = '12px';
    table.innerHTML = `<thead>
      <tr style="background:#f1f5f9;font-weight:700">
        <th style="padding:8px;border:1px solid #e6e9ee">S.No.</th>
        <th style="padding:8px;border:1px solid #e6e9ee">Item</th>
        <th style="padding:8px;border:1px solid #e6e9ee;text-align:right">Qty (kg)</th>
        <th style="padding:8px;border:1px solid #e6e9ee;text-align:right">Rate (₹)</th>
        <th style="padding:8px;border:1px solid #e6e9ee;text-align:right">Amount (₹)</th>
      </tr>
    </thead>`;
    const tbody = document.createElement('tbody');
    editedItems.forEach((it, idx) => {
      const veg = combinedVegetableMap.get(it.vegetableId);
      const name = sanitizeTextForPdf((it as any).name || veg?.name || `Item ${it.vegetableId}`);
      const rate = Number((it as any).pricePerKg || veg?.pricePerKg || 0).toFixed(2);
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #eef2f7';
      tr.innerHTML = `<td style="padding:8px;border:1px solid #e6e9ee">${idx + 1}</td>
        <td style="padding:8px;border:1px solid #e6e9ee">${name}</td>
        <td style="padding:8px;border:1px solid #e6e9ee;text-align:right">${String(it.quantityKg)}</td>
        <td style="padding:8px;border:1px solid #e6e9ee;text-align:right">₹${rate}</td>
        <td style="padding:8px;border:1px solid #e6e9ee;text-align:right">₹${Number(it.subtotal).toFixed(2)}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    // Totals
    const summary = document.createElement('div');
    summary.style.display = 'flex';
    summary.style.justifyContent = 'space-between';
    summary.style.marginTop = '12px';
    summary.innerHTML = `<div style="width:60%;font-size:12px;color:#475569">Thank you for shopping with Engal Santhai. Please preserve this bill for your records.</div>
      <div style="width:36%;border:1px solid #e6e9ee;padding:8px;border-radius:6px"><div style="display:flex;justify-content:space-between;font-weight:700">GRAND TOTAL <div>₹${Math.round(calculatedTotal)}</div></div></div>`;
    container.appendChild(summary);

    // Payment block if selected
    if (selectedUpiId) {
      const upi = UPI_IDS.find(u => u.id === selectedUpiId);
      if (upi) {
        const payDiv = document.createElement('div');
        payDiv.style.marginTop = '12px';
        payDiv.style.padding = '10px';
        payDiv.style.borderRadius = '6px';
        payDiv.style.background = '#f8fafc';
        payDiv.style.border = '1px solid #e6eef4';
        payDiv.innerHTML = `<div style="font-weight:700">PAYMENT INFORMATION</div>
          <div>Payee Name: ${upi.name}</div><div>UPI ID: ${upi.displayName}</div><div>Amount: Rs. ${Math.round(calculatedTotal)}</div>`;
        container.appendChild(payDiv);
      }
    }

    // Attach font link for rendering if available
    const fontLink = document.createElement('link');
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil&display=swap';
    fontLink.rel = 'stylesheet';
    container.appendChild(fontLink);

    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    document.body.appendChild(container);
    await new Promise(res => setTimeout(res, 250));
    return container;
  };

  // Generate PDF and filename
  const generateBillPdfBlobAndFilename = async (): Promise<{ blob: Blob; filename: string }> => {
    // Ensure window.jspdf present
    if (!(window as any).jspdf || !(window as any).jspdf.jsPDF) {
      throw new Error('jsPDF not available on window.jspdf');
    }
    const { jsPDF } = window.jspdf;
    const pdfDoc: any = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const pageWidth = pdfDoc.internal.pageSize.getWidth();
    const pageHeight = pdfDoc.internal.pageSize.getHeight();
    const ITEMS_PER_PAGE = 22;

    // Build filename pieces first
    const billDateObj = new Date(bill.date);
    const dd = String(billDateObj.getDate()).padStart(2, '0');
    const mm = String(billDateObj.getMonth() + 1).padStart(2, '0');
    const yyyy = billDateObj.getFullYear();
    const idMatch = bill.id.match(/(\d{3,})$/);
    let serial = '001';
    if (idMatch) serial = idMatch[1].slice(-3).padStart(3, '0');
    const formattedBillNumber = `ES${dd}${mm}${yyyy}-${serial}`;

    const rawName = (customerNameFromDB || bill.customerName || 'customer').toString();
  const rawDept = (customerDeptFromDB || bill.department || 'NA').toString();
    const sanitizeFile = (s: string) => s.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '').replace(/_+/g, '_');
    const nameSafe = sanitizeFile(rawName).toUpperCase() || 'CUSTOMER';
    const deptSafe = sanitizeFile(rawDept).toUpperCase() || 'NA';
    const fileSerial = (serial || '000');
    const fileDate = `${dd}${mm}${yyyy}`;
    const filename = `${fileSerial}-${fileDate}-${nameSafe}-${deptSafe}.pdf`;

    // Decide fallback: if any text has emoji => raster fallback
    const anyEmoji = containsEmoji(customerNameFromDB || bill.customerName || '') || editedItems.some(it => containsEmoji((it as any).name || ''));
    const preferRaster = anyEmoji;

    // TEXT-BASED PDF (searchable) branch
    if (!preferRaster) {
      try {
        // Attempt to set Tamil font if available; otherwise helvetica will be used
        trySetNotoInPdf(pdfDoc);

        const totalPages = Math.max(1, Math.ceil(editedItems.length / ITEMS_PER_PAGE));
        for (let pageNum = 0; pageNum < totalPages; pageNum++) {
          if (pageNum > 0) pdfDoc.addPage();

          // Header area (no color background, add a light outline)
          pdfDoc.setDrawColor(203, 213, 225); // slate-300
          pdfDoc.setLineWidth(0.4);
          pdfDoc.rect(10, 10, pageWidth - 20, 22, 'S'); // outline only
          pdfDoc.setTextColor(17, 24, 39); // neutral dark text
          pdfDoc.setFontSize(18);
          pdfDoc.setFont(undefined, 'bold');
          pdfDoc.text('Engal Santhai', pageWidth / 2, 24, { align: 'center' });
          pdfDoc.setFontSize(10);
          pdfDoc.setFont(undefined, 'normal');
          pdfDoc.text('Your Fresh Vegetable Partner', pageWidth / 2, 29, { align: 'center' });

          pdfDoc.setFontSize(12);
          pdfDoc.setFont(undefined, 'bold');
          pdfDoc.text('INVOICE', 14, 42);

          const dateStr = billDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
          const timeStr = billDateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
          pdfDoc.setFont(undefined, 'normal');
          pdfDoc.setFontSize(10);
          pdfDoc.text(`BILL NO: ${formattedBillNumber}`, 14, 50);
          pdfDoc.text(`Date: ${dateStr}`, pageWidth - 14, 50, { align: 'right' });
          const safeDept = sanitizeTextForPdf(customerDeptFromDB || bill.department || 'NA');
          pdfDoc.text(`CUSTOMER NAME : ${sanitizeTextForPdf(customerNameFromDB || bill.customerName || '')}`, 14, 56);
          pdfDoc.text(`Time: ${timeStr}`, pageWidth - 14, 56, { align: 'right' });
          pdfDoc.text(`EMP ID: ${(bill.customerId || bill.customerName || 'N/A')}`, 14, 64);
          pdfDoc.text(`DEPT: ${safeDept.toUpperCase()}`, pageWidth - 14, 64, { align: 'right' });

          // Table headings & columns
          let y = 74;
          const startX = 14;
          const endX = pageWidth - 14;
          const colSNo = startX;
          const colItem = startX + 18;
          const colQty = startX + 96;
          const colRate = startX + 126;
          const colAmount = endX;
          pdfDoc.setLineWidth(0.2);
          pdfDoc.line(startX, y - 6, endX, y - 6);

          pdfDoc.setFont(undefined, 'bold');
          pdfDoc.setFontSize(10);
          pdfDoc.text('S.No.', colSNo, y);
          pdfDoc.text('Item', colItem, y);
          pdfDoc.text('Qty (kg)', colQty, y, { align: 'right' });
          pdfDoc.text('Rate (Rs.)', colRate, y, { align: 'right' });
          pdfDoc.text('Amount (Rs.)', colAmount, y, { align: 'right' });
          y += 8;
          pdfDoc.setLineWidth(0.2);
          pdfDoc.line(startX, y, endX, y);
          y += 6;

          const startIdx = pageNum * ITEMS_PER_PAGE;
          const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, editedItems.length);
          const pageItems = editedItems.slice(startIdx, endIdx);

          pdfDoc.setFont('NotoSansTamil' in (pdfDoc as any).fList ? 'NotoSansTamil' : 'helvetica', 'normal');
          pdfDoc.setFontSize(10);

          for (let i = 0; i < pageItems.length; i++) {
            const item = pageItems[i];
            const veg = combinedVegetableMap.get(item.vegetableId);
            const rawName = (item as any).name || veg?.name || 'Unknown';
            const name = sanitizeTextForPdf(rawName) || 'Unknown';
            const qty = String(item.quantityKg);
            const rateStr = Number((item as any).pricePerKg || veg?.pricePerKg || 0).toFixed(2);
            const amountStr = Number(item.subtotal).toFixed(2);

            const maxItemWidth = colQty - colItem - 4;
            const splitName: string[] = (pdfDoc as any).splitTextToSize ? (pdfDoc as any).splitTextToSize(name, maxItemWidth) : [name];
            // S.No
            pdfDoc.setFont('helvetica', 'normal');
            pdfDoc.text(String(startIdx + i + 1), colSNo, y);

            // Name (use Tamil font if present)
            try {
              pdfDoc.setFont('NotoSansTamil');
            } catch (e) {
              pdfDoc.setFont('helvetica');
            }
            pdfDoc.text(splitName, colItem, y);

            // Numeric columns in helvetica
            pdfDoc.setFont('helvetica', 'normal');
            pdfDoc.text(qty, colQty, y, { align: 'right' });
            pdfDoc.text(`₹${rateStr}`, colRate, y, { align: 'right' });
            pdfDoc.text(`₹${amountStr}`, colAmount, y, { align: 'right' });

            y += (splitName.length || 1) * 6;

            if (y > pageHeight - 60) {
              // break to next page (loop will continue)
              break;
            }
          }

          // Footer totals on last page
          if (pageNum === totalPages - 1) {
            pdfDoc.setLineWidth(0.4);
            pdfDoc.line(startX, pageHeight - 60, endX, pageHeight - 60);
            pdfDoc.setFont(undefined, 'bold');
            pdfDoc.setFontSize(12);
            pdfDoc.text('TOTAL:', colRate, pageHeight - 50);
            pdfDoc.text(`Rs. ${Math.round(calculatedTotal)}`, colAmount, pageHeight - 50, { align: 'right' });

            // Payment details
            if (selectedUpiId) {
              const selectedUpi = UPI_IDS.find(u => u.id === selectedUpiId);
              if (selectedUpi) {
                const boxY = pageHeight - 40;
                pdfDoc.setDrawColor(230, 238, 238);
                pdfDoc.rect(startX, boxY, endX - startX, 28, 'S');
                pdfDoc.setFontSize(10);
                pdfDoc.setFont(undefined, 'bold');
                pdfDoc.text('PAYMENT INFORMATION', startX + 2, boxY + 7);
                pdfDoc.setFont(undefined, 'normal');
                pdfDoc.setFontSize(9);
                pdfDoc.text(`Payee Name: ${selectedUpi.name}`, startX + 2, boxY + 12);
                pdfDoc.text(`UPI ID: ${selectedUpi.displayName}`, startX + 2, boxY + 17);
                pdfDoc.text(`Amount: Rs. ${Math.round(calculatedTotal)}`, startX + 2, boxY + 22);
              }
            }
          }
        }

        const blob = pdfDoc.output('blob');
        return { blob, filename };
      } catch (err) {
        console.error('Text-based PDF generation failed, falling back to raster', err);
      }
    }

    // Raster fallback using html2canvas (for emojis or if text path failed)
    try {
      const element = await createPrintableBillElement();
      const scale = 2; // good resolution
      const canvas = await html2canvas(element as HTMLElement, { scale, useCORS: true, logging: false, scrollY: -window.scrollY });
      try { document.body.removeChild(element); } catch {}
      // Use JPEG at high quality for much smaller file size with similar visual quality
      const imgData = canvas.toDataURL('image/jpeg', 0.9);
      const imgProps = (pdfDoc as any).getImageProperties(imgData);
      const imgWidth = pageWidth;
      const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdfDoc.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        pdfDoc.addPage();
        position = heightLeft - imgHeight;
        pdfDoc.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      const blob = pdfDoc.output('blob');
      return { blob, filename };
    } catch (rasterErr) {
      console.error('Raster fallback failed', rasterErr);
      // Final minimal PDF
      try {
        const fallback = new jsPDF();
        fallback.text('Unable to generate bill PDF. Please contact support.', 10, 10);
        const blob = fallback.output('blob');
        return { blob, filename };
      } catch (finalErr) {
        console.error('Final fallback failed', finalErr);
        throw new Error('PDF generation failed.');
      }
    }
  };

  const handleDownload = async () => {
    try {
      const { blob, filename } = await generateBillPdfBlobAndFilename();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed', err);
      alert('Failed to download PDF. Check console.');
    }
  };

  const normalizePhoneForWhatsApp = (raw: string | undefined | null): string | null => {
    if (!raw) return null;
    let digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    while (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
    if (digits.length === 10) return `91${digits}`;
    return digits;
  };

  const copyUpiId = async (upiId: string) => {
    try {
      await navigator.clipboard.writeText(upiId);
    } catch (err) {
      console.error('Failed to copy UPI ID:', err);
    }
  };

  const handleShare = async () => {
    try {
      setIsSharing(true);
      if (!bill) {
        throw new Error('Bill details not available.');
      }

      if (hasUnsavedChanges) {
        await handleSaveChanges();
      }

      // Resolve recipient phone number: try customerId doc first, then fallback by employee_name/name
      let phoneNumber: string | null = null;
      try {
        if (bill.customerId) {
          const userDocRef = doc(db, 'users', bill.customerId);
          const userSnap = await getDoc(userDocRef);
          if (userSnap.exists()) {
            const d: any = userSnap.data();
            phoneNumber = String(
              d.phone || d.whatsapp || d.whatsapp_number || d.phoneNumber || d.phone_number || d.mobile || d.contact || ''
            ) || null;
          }
        }
      } catch (e) {
        console.warn('CustomerId lookup failed', e);
      }

      if (!phoneNumber) {
        let employeeNameToQuery = billTyped?.employee_name || customerNameFromDB || bill.customerName || '';
        let retries = 0;
        while ((!employeeNameToQuery || employeeNameToQuery === 'Unknown Customer') && retries < 5) {
          await new Promise(res => setTimeout(res, 200));
          employeeNameToQuery = billTyped?.employee_name || customerNameFromDB || bill.customerName || '';
          retries++;
        }
        if (employeeNameToQuery.trim()) {
          try {
            const usersRef = collection(db, 'users');
            const q1 = query(usersRef, where('employee_name', '==', employeeNameToQuery));
            const snap1 = await getDocs(q1);
            let userData: any = null;
            if (!snap1.empty) userData = snap1.docs[0].data();
            else {
              const q2 = query(usersRef, where('name', '==', employeeNameToQuery));
              const snap2 = await getDocs(q2);
              if (!snap2.empty) userData = snap2.docs[0].data();
            }
            if (userData) {
              phoneNumber = String(
                userData.phone || userData.whatsapp || userData.whatsapp_number || userData.phoneNumber || userData.phone_number || userData.mobile || userData.contact || ''
              ) || null;
            }
          } catch (err) {
            console.error('Firestore user lookup failed', err);
          }
        }
      }

      // Generate PDF once for both upload and native share
      const { blob, filename } = await generateBillPdfBlobAndFilename();

      // Extract and format bill date and number
      const billDateObj = (() => {
        const d = new Date(bill.date);
        return Number.isNaN(d.getTime()) ? new Date() : d;
      })();
      const dd = String(billDateObj.getDate()).padStart(2, '0');
      const mm = String(billDateObj.getMonth() + 1).padStart(2, '0');
      const yyyy = billDateObj.getFullYear();
      const messageDate = `${dd}.${mm}.${yyyy}`;
      const idMatch = bill.id?.match?.(/([\d]{3,})$/);
      const serial = idMatch ? idMatch[1].slice(-3).padStart(3, '0') : '001';
      const formattedBillNumber = `ES${dd}${mm}${yyyy}-${serial}`;
      const storageFilename = `${formattedBillNumber}.pdf`;
      const storagePath = `bills/${storageFilename}`;
      const storageUri = `gs://engal-sandhai.firebasestorage.app/${storagePath}`;

      // Upload to Firebase Storage (optional - share will continue even if this fails)
      let downloadUrl = bill.pdfDownloadUrl;
      try {
        const storage = getStorage();
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, blob, {
          contentType: 'application/pdf',
          customMetadata: {
            billId: bill.id,
            billNumber: formattedBillNumber,
            customerName: customerNameFromDB || bill.customerName || 'Unknown',
            generatedAt: new Date().toISOString()
          }
        });
        downloadUrl = await getDownloadURL(storageRef);
      } catch (uploadErr) {
        console.error('⚠️ PDF upload failed (continuing with share):', uploadErr);
        downloadUrl = 'Kindly download your bill from the link.';
      }

      // Persist metadata on the bill
      if (onUpdateBill) {
        try {
          const updates: Partial<Bill> = {
            pdfDownloadUrl: downloadUrl,
            pdfStoragePath: storagePath,
            pdfStorageUri: storageUri,
            lastSharedAt: new Date().toISOString(),
          };
          if (currentUser?.id) {
            updates.lastSharedBy = currentUser.id;
          }
          await onUpdateBill(bill.id, updates);
        } catch (updateErr) {
          console.error('Failed to persist PDF metadata', updateErr);
        }
      }

      const normalized = normalizePhoneForWhatsApp(phoneNumber);

      // Build enhanced WhatsApp message with formatted date and download link
      const payee = UPI_IDS[0];
      const totalAmount = Number.isFinite(calculatedTotal) ? calculatedTotal : (bill.total || 0);
      const roundedTotal = Math.round(totalAmount ?? 0);
      const totalDisplay = new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(roundedTotal);

      const messageLines = [
        '🌟 Hello!',
        `Thank you for ordering from Engal Sandhai on ${messageDate} 🙏`,
        '',
        'Your Engal Sandhai Bill is ready.',
        `Total: ₹${totalDisplay}`,
        '',
        '📄 Download your E-bill here:',
        downloadUrl || 'Kindly download your bill from the link.',
        '',
        '📌 Please make your payment to the following UPI ID:',
        payee.displayName,
        '📷 Once done, kindly send a screenshot of the payment confirmation here.',
        '',
        'Thank You!'
      ];
      const message = messageLines.join('\n');

      try {
        await navigator.clipboard.writeText(message);
      } catch (err) {
        console.warn('Copy message failed', err);
      }

      const waUrl = normalized
        ? `https://api.whatsapp.com/send?phone=${encodeURIComponent(normalized)}&text=${encodeURIComponent(message)}`
        : `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
      window.open(waUrl, '_blank');

      // Try native share with file (reuse generated PDF)
      try {
        const shareFile = new File([blob], storageFilename, { type: 'application/pdf' });
        if ((navigator as any).share && (navigator as any).canShare?.({ files: [shareFile] })) {
          await (navigator as any).share({ title: 'Engal Santhai Bill', text: message, files: [shareFile] });
        }
      } catch (shareErr) {
        console.warn('Native share failed', shareErr);
      }
    } catch (err) {
      console.error('Share flow failed', err);
      alert('Unable to share bill. Please try downloading manually.');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
      >
        {/* Stock Alert Notification */}
        {stockAlert?.show && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[10000] w-11/12 max-w-md">
            <div className="bg-white border border-red-300 rounded-lg shadow-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <div className="flex-1">
                  <h4 className="font-semibold text-slate-800 text-sm mb-2">Stock Limit Exceeded</h4>
                  <div className="bg-slate-50 rounded p-2 border border-slate-200">
                    <div className="font-medium text-slate-700">{stockAlert.itemName}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      You wanted <span className="font-semibold text-red-600">{stockAlert.requested}{(() => {
                        const veg = combinedVegetableMap.get(editedItems.find(i => (i as any).name === stockAlert.itemName || combinedVegetableMap.get(i.vegetableId)?.name === stockAlert.itemName)?.vegetableId || '');
                        return veg?.unitType === 'COUNT' ? ' count' : 'kg';
                      })()}</span>, only <span className="font-semibold text-green-600">{stockAlert.available}{(() => {
                        const veg = combinedVegetableMap.get(editedItems.find(i => (i as any).name === stockAlert.itemName || combinedVegetableMap.get(i.vegetableId)?.name === stockAlert.itemName)?.vegetableId || '');
                        return veg?.unitType === 'COUNT' ? ' count' : 'kg';
                      })()}</span> available
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">Quantity adjusted to available stock</p>
                </div>
                <button onClick={() => setStockAlert(null)} className="text-slate-400 hover:text-slate-600">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
        
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-fade-in-down">
          <div className="flex items-center justify-between p-4 border-b bg-slate-50 rounded-t-lg">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Bill Details</h2>
              {hasUnsavedChanges && <p className="text-sm text-amber-600 font-medium">• Unsaved changes</p>}
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200">
              <XMarkIcon className="h-6 w-6 text-slate-600" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <p className="text-sm text-slate-500">Bill Number</p>
                <p className="font-mono text-sm text-slate-800">
                  {(() => {
                    const billDateObj = new Date(bill.date);
                    const dd = String(billDateObj.getDate()).padStart(2, '0');
                    const mm = String(billDateObj.getMonth() + 1).padStart(2, '0');
                    const yyyy = billDateObj.getFullYear();
                    let serial = '001';
                    const idMatch = bill.id.match(/(\d{3,})$/);
                    if (idMatch) serial = idMatch[1].slice(-3).padStart(3, '0');
                    return `ES${dd}${mm}${yyyy}-${serial}`;
                  })()}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Customer Name</p>
                <p className="font-semibold text-slate-800">{customerNameFromDB || bill.customerName}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Date</p>
                <p className="font-semibold text-slate-800">{new Date(bill.date).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Payment Screenshot</p>
                {bill.paymentScreenshot ? (
                  <button onClick={() => setIsImagePreviewOpen(true)} className="text-sm font-semibold text-primary-600 hover:underline flex items-center">
                    <EyeIcon className="h-4 w-4 mr-1" /> View Screenshot
                  </button>
                ) : (
                  <p className="text-sm text-slate-400">Not provided</p>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-lg font-bold text-slate-800 mb-2">Order Items</h3>
              <p className="text-xs text-slate-500 mb-2">Reference checkboxes: optional, for your reference only (not required and not saved by default).</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-slate-500">
                  <thead className="text-xs text-slate-700 uppercase bg-slate-50">
                    <tr>
                      <th scope="col" className="px-2 py-2 w-8 text-center"> </th>
                      <th scope="col" className="px-2 py-2 w-12 text-center">S.No.</th>
                      <th scope="col" className="px-4 py-2">Item</th>
                      <th scope="col" className="px-4 py-2 text-right">Quantity</th>
                      <th scope="col" className="px-4 py-2 text-right">Rate</th>
                      <th scope="col" className="px-4 py-2 text-right">Subtotal</th>
                      <th scope="col" className="px-4 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editedItems.map((item, index) => {
                      const checkKey = `${item.vegetableId}::${index}`;
                      const vegetable = combinedVegetableMap.get(item.vegetableId);
                      return (
                        <tr key={index} className="bg-white border-b last:border-0">
                          <td className="px-2 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={!!itemChecks[checkKey]}
                              onChange={() => setItemChecks(prev => ({ ...prev, [checkKey]: !prev[checkKey] }))}
                              className="h-4 w-4 text-primary-600 rounded"
                              aria-label={`Reference checkbox for item ${index + 1}`}
                            />
                          </td>
                          <td className="px-2 py-3 text-center font-medium text-slate-700">{index + 1}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {isLoadingVegetables && !vegetable ? (
                              <div className="flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
                                Loading...
                              </div>
                            ) : (
                              <>
                                {vegetable?.name || `Item ${item.vegetableId}`}
                                {!vegetable && !isLoadingVegetables && (
                                  <div className="text-xs text-amber-600 mt-1">⚠️ Using calculated price: ₹{(item.subtotal / (item.quantityKg || 1)).toFixed(2)}/kg</div>
                                )}
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number"
                                value={vegetable?.unitType === 'COUNT' ? Math.floor(item.quantityKg) : item.quantityKg}
                                onChange={(e) => handleQuantityChange(index, parseFloat(e.target.value) || 0)}
                                className="w-16 text-right bg-white border border-slate-200 rounded px-2 py-1 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 font-medium text-slate-900"
                                min="0"
                                step={vegetable?.unitType === 'COUNT' ? '1' : '0.25'}
                                onFocus={(e) => e.target.select()}
                              />
                              <span className="text-xs text-slate-500 w-8">
                                {vegetable?.unitType === 'COUNT' ? 'count' : 'kg'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {(() => {
                              if (vegetable) return `₹${Number(vegetable.pricePerKg).toFixed(2)}`;
                              if ((item as any).pricePerKg) return `₹${Number((item as any).pricePerKg).toFixed(2)}`;
                              if (item.quantityKg > 0) {
                                const cp = item.subtotal / (item.quantityKg || 1);
                                return `₹${Number(cp).toFixed(2)}`;
                              }
                              return '₹0.00';
                            })()}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-primary-600">₹{Number(item.subtotal).toFixed(2)}</td>
                          <td className="px-4 py-3 text-center">
                            <button onClick={() => handleRemoveVegetable(item.vegetableId)} className="text-red-600 hover:text-red-800 font-semibold px-2 py-1 rounded hover:bg-red-50" title="Remove item">✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Add Vegetables Section */}
            <div className="border-t border-slate-200 pt-4 mt-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-semibold text-slate-800">Add Vegetables</h4>
                <Button onClick={() => setShowAddVegetables(!showAddVegetables)} className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2">
                  {showAddVegetables ? 'Hide' : 'Add Items'}
                </Button>
              </div>

              {showAddVegetables && (
                <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                  {getAvailableVegetables().length > 0 ? (
                    getAvailableVegetables().map(veg => (
                      <VegetableAddRow key={veg.id} vegetable={veg} availableStock={getEffectiveAvailableStock(veg.id)} onAdd={(quantity) => { handleAddVegetable(veg.id, quantity); setShowAddVegetables(false); }} />
                    ))
                  ) : (
                    <p className="text-slate-500 text-center py-4">All available vegetables are already in this order</p>
                  )}
                </div>
              )}
            </div>

            {/* UPI Selection Section */}
            <div className="mt-6 pt-4 border-t-2 border-slate-200">
              <div className="bg-gradient-to-r from-blue-50 to-green-50 p-4 rounded-lg mb-4">
                <h3 className="text-lg font-semibold text-slate-800 mb-2 flex items-center">💳 Select UPI ID for Payment</h3>
                <p className="text-sm text-slate-600">Choose a UPI ID to generate the payment QR code and download the bill</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {UPI_IDS.map(upi => (
                  <div key={upi.id} className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${selectedUpiId === upi.id ? 'border-green-500 bg-green-50' : 'border-slate-300 hover:border-slate-400'}`} onClick={() => setSelectedUpiId(upi.id)}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-slate-800">{upi.name}</p>
                        <p className="text-sm text-slate-600">{upi.displayName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); copyUpiId(upi.id); }} className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded text-slate-600" title="Copy UPI ID">Copy</button>
                        <div className={`w-4 h-4 rounded-full border-2 ${selectedUpiId === upi.id ? 'border-green-500 bg-green-500' : 'border-slate-300'}`}>
                          {selectedUpiId === upi.id && <div className="w-full h-full rounded-full bg-white scale-50"></div>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {selectedUpiId ? (
                <div className="bg-slate-50 p-6 rounded-lg">
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-700 mb-3">Payment QR Code for: {UPI_IDS.find(u => u.id === selectedUpiId)?.displayName}</p>
                    <div className="inline-block p-4 bg-white rounded-lg shadow-sm">
                      <img src={qrImg} alt="UPI QR Code" className="w-32 h-32 mx-auto rounded border" />
                    </div>
                    <p className="text-xs text-slate-500 mt-2">Scan this QR code to pay ₹{Math.round(calculatedTotal)}</p>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                  <div className="text-center">
                    <p className="text-sm text-amber-700">Please select a UPI ID above to view the payment QR code</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-200">
              <div className="flex gap-3">
                <Button onClick={handleSaveChanges} disabled={!hasUnsavedChanges || isSaving} className={`${hasUnsavedChanges ? 'bg-green-600 hover:bg-green-700' : 'bg-slate-400 cursor-not-allowed'} text-white`}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>

                <Button onClick={handleShare} disabled={isSharing} className={`${isSharing ? 'bg-primary-400 cursor-wait' : 'bg-primary-600 hover:bg-primary-700'} text-white`} title={isSharing ? 'Uploading bill to storage...' : 'Share bill via WhatsApp or other apps'}>
                  {isSharing ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2"></div>
                      Sharing...
                    </>
                  ) : (
                    <>
                      <ShareIcon className="h-5 w-5 mr-2" /> Share
                    </>
                  )}
                </Button>

                <Button onClick={handleDownload} disabled={!selectedUpiId} className={`${selectedUpiId ? 'bg-slate-600 hover:bg-slate-700' : 'bg-slate-400 cursor-not-allowed'}`} title={!selectedUpiId ? 'Please select a UPI ID first' : ''}>
                  <ArrowDownTrayIcon className="h-5 w-5 mr-2" /> Download Bill
                </Button>
              </div>

              <div className="text-right">
                <p className="text-sm text-slate-500">Total Amount</p>
                <p className="text-2xl font-bold text-slate-800">₹{Math.round(calculatedTotal)}</p>
                {Number(calculatedTotal) !== Number(bill.total) && <p className="text-xs text-slate-500 mt-1">Original: ₹{Math.round(bill.total)}</p>}
              </div>
            </div>

          </div>
        </div>
      </div>

      <ImagePreviewModal isOpen={isImagePreviewOpen} onClose={() => setIsImagePreviewOpen(false)} imageUrl={bill.paymentScreenshot || ''} />
    </>
  );
};

// Component for adding vegetables to the order
interface VegetableAddRowProps {
  vegetable: Vegetable;
  onAdd: (quantity: number) => void;
  availableStock: number;
}

const VegetableAddRow: React.FC<VegetableAddRowProps> = ({ vegetable, onAdd, availableStock }) => {
  const isCount = vegetable.unitType === 'COUNT';
  const minQty = isCount ? 1 : 0.25;
  const stepQty = isCount ? 1 : 0.25;
  const [quantity, setQuantity] = useState(minQty);

  const handleAdd = () => {
    if (quantity > 0) {
      const finalQty = isCount ? Math.floor(quantity) : quantity;
      onAdd(finalQty);
      setQuantity(minQty);
    }
  };
  
  const handleDecrement = () => {
    setQuantity(Math.max(minQty, isCount ? Math.floor(quantity) - 1 : quantity - stepQty));
  };
  
  const handleIncrement = () => {
    const newQty = isCount ? Math.floor(quantity) + 1 : quantity + stepQty;
    // Don't allow incrementing beyond available stock
    if (newQty <= availableStock) {
      setQuantity(newQty);
    }
  };
  
  const handleInputChange = (value: number) => {
    if (isCount) {
      const newQty = Math.max(minQty, Math.floor(value || minQty));
      setQuantity(Math.min(newQty, availableStock)); // Cap at available stock
    } else {
      const newQty = Math.max(minQty, value || minQty);
      setQuantity(Math.min(newQty, availableStock)); // Cap at available stock
    }
  };

  return (
    <div className="flex items-center justify-between bg-white rounded-lg p-3 border border-slate-200">
      <div className="flex items-center gap-3">
        <div>
          <h5 className="font-medium text-slate-800">{vegetable.name}</h5>
          <p className="text-sm text-slate-600">₹{vegetable.pricePerKg}/{isCount ? 'count' : 'kg'}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <button onClick={handleDecrement} className="w-6 h-6 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700 flex items-center justify-center text-sm font-semibold" disabled={quantity <= minQty}>-</button>
          <input 
            type="number" 
            value={isCount ? Math.floor(quantity) : quantity} 
            onChange={(e) => handleInputChange(parseFloat(e.target.value))} 
            className="w-16 text-center border border-slate-300 rounded px-2 py-1 text-sm" 
            min={minQty}
            max={availableStock}
            step={stepQty} 
          />
          <button onClick={handleIncrement} className="w-6 h-6 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700 flex items-center justify-center text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed" disabled={quantity >= availableStock}>+</button>
          <span className="text-sm text-slate-500">{isCount ? 'count' : 'kg'}</span>
        </div>

        <Button onClick={handleAdd} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 text-sm">Add ₹{(quantity * vegetable.pricePerKg).toFixed(2)}</Button>
      </div>
    </div>
  );
};

export default BillDetailModal;