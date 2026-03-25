/**
 * Utility to bulk recalculate and update all bills in the database
 * Use this to fix bills with incorrect calculations
 */

import { collection, getDocs, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Bill, Vegetable, BillItem } from '../../types/types';
import { roundTotal } from './roundUtils';

interface RecalculationResult {
  billId: string;
  oldTotal: number;
  newTotal: number;
  updated: boolean;
  error?: string;
}

/**
 * Fetches vegetables for a specific date
 */
async function getVegetablesForDate(dateKey: string): Promise<Map<string, Vegetable>> {
  const vegetableMap = new Map<string, Vegetable>();
  
  try {
    const vegetablesRef = collection(db, 'vegetables', dateKey, 'items');
    const snapshot = await getDocs(vegetablesRef);
    
    snapshot.forEach(doc => {
      const data = doc.data();
      vegetableMap.set(doc.id, {
        id: doc.id,
        name: data.name || '',
        unitType: data.unitType || 'KG',
        pricePerKg: data.pricePerKg || 0,
        totalStockKg: data.totalStockKg || 0,
        stockKg: data.stockKg || 0,
        category: data.category || '',
      });
    });
    
  } catch (error) {
    console.error(`Error loading vegetables for ${dateKey}:`, error);
  }
  
  return vegetableMap;
}

/**
 * Recalculates bill items using current vegetable prices
 */
function recalculateBillItems(
  items: BillItem[],
  vegetableMap: Map<string, Vegetable>
): { items: BillItem[]; total: number } {
  const recalculatedItems = items.map(item => {
    const veg = vegetableMap.get(item.vegetableId);
    if (veg) {
      const newSubtotal = Math.round(item.quantityKg * veg.pricePerKg * 100) / 100;
      return { ...item, subtotal: newSubtotal, pricePerKg: veg.pricePerKg };
    }
    return item;
  });
  
  const finalTotal = recalculatedItems.reduce((sum, item) => sum + (item.subtotal || 0), 0);
  const roundedTotal = roundTotal(finalTotal);
  
  return { items: recalculatedItems, total: roundedTotal };
}

/**
 * Gets the date key from bill ID or date
 */
function getDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Bulk recalculates and updates all bills for a specific date
 */
export async function recalculateBillsForDate(
  targetDate: Date
): Promise<RecalculationResult[]> {
  const results: RecalculationResult[] = [];
  const dateKey = getDateKey(targetDate);
  
  
  try {
    // Load vegetables for this date
    const vegetableMap = await getVegetablesForDate(dateKey);
    
    if (vegetableMap.size === 0) {
      console.warn(`⚠️ No vegetables found for ${dateKey}, skipping recalculation`);
      return results;
    }
    
    // Get all bills for this date
    const billsRef = collection(db, 'orders', dateKey, 'items');
    const billsSnapshot = await getDocs(billsRef);
    
    
    // Process each bill
    for (const billDoc of billsSnapshot.docs) {
      const billData = billDoc.data() as Bill;
      const billId = billDoc.id;
      
      try {
        if (!billData.items || billData.items.length === 0) {
          continue;
        }
        
        // Recalculate
        const { items: recalculatedItems, total: newTotal } = recalculateBillItems(
          billData.items,
          vegetableMap
        );
        
        const oldTotal = billData.total || 0;
        const hasChanges = Math.abs(newTotal - oldTotal) > 0.01; // Check if difference is significant
        
        if (hasChanges) {
          // Update the bill in database
          const billRef = doc(db, 'orders', dateKey, 'items', billId);
          await updateDoc(billRef, {
            items: recalculatedItems,
            total: newTotal,
          });
          
          results.push({
            billId,
            oldTotal,
            newTotal,
            updated: true,
          });
          
        } else {
          results.push({
            billId,
            oldTotal,
            newTotal,
            updated: false,
          });
          
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          billId,
          oldTotal: billData.total || 0,
          newTotal: 0,
          updated: false,
          error: errorMsg,
        });
        
        console.error(`❌ Error processing ${billId}:`, error);
      }
    }
    
    // Summary
    const updatedCount = results.filter(r => r.updated).length;
    const errorCount = results.filter(r => r.error).length;
    const totalDifference = results.reduce((sum, r) => sum + (r.newTotal - r.oldTotal), 0);
    
    
  } catch (error) {
    console.error(`❌ Fatal error during bulk recalculation:`, error);
    throw error;
  }
  
  return results;
}

/**
 * Recalculates bills for multiple dates
 */
export async function recalculateBillsForDateRange(
  startDate: Date,
  endDate: Date
): Promise<Map<string, RecalculationResult[]>> {
  const resultsByDate = new Map<string, RecalculationResult[]>();
  
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    const dateKey = getDateKey(currentDate);
    
    try {
      const results = await recalculateBillsForDate(currentDate);
      resultsByDate.set(dateKey, results);
    } catch (error) {
      console.error(`Error processing ${dateKey}:`, error);
      resultsByDate.set(dateKey, []);
    }
    
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Overall summary
  let totalBills = 0;
  let totalUpdated = 0;
  let totalErrors = 0;
  let totalRevChange = 0;
  
  resultsByDate.forEach((results, dateKey) => {
    totalBills += results.length;
    totalUpdated += results.filter(r => r.updated).length;
    totalErrors += results.filter(r => r.error).length;
    totalRevChange += results.reduce((sum, r) => sum + (r.newTotal - r.oldTotal), 0);
  });
  
  
  return resultsByDate;
}
