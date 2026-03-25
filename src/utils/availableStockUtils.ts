import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  increment,
  runTransaction
} from 'firebase/firestore';
import { db } from '../firebase';
import { AvailableStock } from '../types/firestore';

/**
 * Create or update available stock entry
 */
export const upsertAvailableStock = async (stockData: Omit<AvailableStock, 'lastUpdated'> & { updatedBy?: string }) => {
  try {
    const availableStockRef = doc(db, 'availableStock', stockData.productId);
    const stockDoc = await getDoc(availableStockRef);

    const availableStockData: AvailableStock = {
      ...stockData,
      lastUpdated: new Date(),
      updatedBy: stockData.updatedBy || 'system'
    };

    if (stockDoc.exists()) {
      // Update existing entry
      await updateDoc(availableStockRef, {
        ...availableStockData,
        lastUpdated: availableStockData.lastUpdated,
        updatedBy: availableStockData.updatedBy
      });
    } else {
      // Create new entry
      await setDoc(availableStockRef, availableStockData);
    }

    return availableStockData;
  } catch (error) {
    console.error('Error upserting available stock:', error);
    console.error('Stock data:', stockData);
    throw error;
  }
};

/**
 * Update available stock when items are purchased
 */
export const reduceAvailableStock = async (productId: string, quantitySold: number, updatedBy: string = 'system') => {
  try {
    const availableStockRef = doc(db, 'availableStock', productId);
    const stockDoc = await getDoc(availableStockRef);

    if (stockDoc.exists()) {
      const currentData = stockDoc.data() as AvailableStock;
      await updateDoc(availableStockRef, {
        availableStockKg: increment(-quantitySold),
        lastUpdated: new Date(),
        updatedBy: updatedBy
      });

      // Return -1 or approximate since we used increment and didn't read back
      return Math.max(0, currentData.availableStockKg - quantitySold);
    } else {
      console.warn(`Available stock not found for product ${productId}. Creating new entry...`);
      // Try to create a basic entry if it doesn't exist
      await setDoc(availableStockRef, {
        productId: productId,
        productName: 'Unknown Product',
        category: 'Unknown',
        pricePerKg: 0,
        totalStockKg: 0,
        availableStockKg: 0,
        unitType: 'KG',
        lastUpdated: new Date(),
        updatedBy: updatedBy
      });
      return 0;
    }
  } catch (error) {
    console.error('Error reducing available stock:', error);
    console.error('Product ID:', productId, 'Quantity sold:', quantitySold);
    throw error;
  }
};

/**
 * Update available stock when inventory is updated
 */
export const updateAvailableStockFromInventory = async (
  productId: string,
  totalStockKg: number,
  updatedBy: string = 'system'
) => {
  try {
    const availableStockRef = doc(db, 'availableStock', productId);
    const stockDoc = await getDoc(availableStockRef);

    if (stockDoc.exists()) {
      const currentData = stockDoc.data() as AvailableStock;
      const quantityDifference = totalStockKg - currentData.totalStockKg;
      const newAvailableStock = Math.max(0, currentData.availableStockKg + quantityDifference);

      await updateDoc(availableStockRef, {
        totalStockKg: totalStockKg,
        availableStockKg: newAvailableStock,
        lastUpdated: new Date(),
        updatedBy: updatedBy
      });

      return newAvailableStock;
    } else {
      console.warn(`Available stock not found for product ${productId}. Cannot update.`);
      return 0;
    }
  } catch (error) {
    console.error('Error updating available stock from inventory:', error);
    throw error;
  }
};

/**
 * Delete available stock entry
 */
export const deleteAvailableStock = async (productId: string) => {
  try {
    const availableStockRef = doc(db, 'availableStock', productId);

    // Check if document exists before trying to delete
    const stockDoc = await getDoc(availableStockRef);
    if (stockDoc.exists()) {
      await deleteDoc(availableStockRef);
    } else {
      console.warn(`Available stock not found for product ${productId}, nothing to delete`);
    }
  } catch (error) {
    console.error('Error deleting available stock:', error);
    console.error('Product ID:', productId);
    throw error;
  }
};

/**
 * Get all available stock entries
 */
export const getAllAvailableStock = async (): Promise<AvailableStock[]> => {
  try {
    const availableStockRef = collection(db, 'availableStock');
    const snapshot = await getDocs(availableStockRef);

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as AvailableStock & { id: string }));
  } catch (error) {
    console.error('Error fetching available stock:', error);
    throw error;
  }
};

/**
 * Get available stock for a specific product
 */
export const getAvailableStock = async (productId: string): Promise<AvailableStock | null> => {
  try {
    const availableStockRef = doc(db, 'availableStock', productId);
    const stockDoc = await getDoc(availableStockRef);

    if (stockDoc.exists()) {
      return {
        id: stockDoc.id,
        ...stockDoc.data()
      } as AvailableStock & { id: string };
    }

    return null;
  } catch (error) {
    console.error('Error fetching available stock for product:', error);
    throw error;
  }
};

/**
 * Batch update available stock for multiple products (used in purchases)
 */
export const batchUpdateAvailableStock = async (
  updates: Array<{ productId: string; quantitySold: number }>,
  updatedBy: string = 'system'
) => {
  try {

    const promises = updates.map(async (update) => {
      return await reduceAvailableStock(update.productId, update.quantitySold, updatedBy);
    });

    const results = await Promise.all(promises);

    return results;
  } catch (error) {
    console.error('Error in batch update available stock:', error);
    console.error('Updates that failed:', updates);
    throw error;
  }
};

/**
 * Sync available stock with vegetables collection
 * This should be called when vegetables are added/updated/deleted
 */
export const syncAvailableStockWithVegetables = async (vegetable: any, action: 'add' | 'update' | 'delete', updatedBy: string = 'system') => {
  try {
    switch (action) {
      case 'add':
        await upsertAvailableStock({
          productId: vegetable.id,
          productName: vegetable.name,
          category: vegetable.category,
          pricePerKg: vegetable.pricePerKg,
          totalStockKg: vegetable.totalStockKg,
          availableStockKg: vegetable.totalStockKg, // Initialize with total stock
          unitType: vegetable.unitType || 'KG',
          updatedBy: updatedBy
        });
        break;

      case 'update':
        // Use transaction to safely calculate difference and update
        await runTransaction(db, async (transaction) => {
          const stockRef = doc(db, 'availableStock', vegetable.id);
          const stockDoc = await transaction.get(stockRef);

          let newAvailable = vegetable.totalStockKg;

          if (stockDoc.exists()) {
            const currentData = stockDoc.data() as AvailableStock;
            // Calculate difference: new total - old total
            // Example: Old Total 100, New Total 150 (Diff +50). Old Available 20 -> New Available 70.
            // Example: Old Total 100, New Total 100 (Diff 0). Old Available 20 -> New Available 20.
            const diff = vegetable.totalStockKg - currentData.totalStockKg;
            newAvailable = Math.max(0, currentData.availableStockKg + diff);
          }

          transaction.set(stockRef, {
            productId: vegetable.id,
            productName: vegetable.name,
            category: vegetable.category,
            pricePerKg: vegetable.pricePerKg,
            totalStockKg: vegetable.totalStockKg,
            availableStockKg: newAvailable,
            unitType: vegetable.unitType || 'KG',
            lastUpdated: new Date(),
            updatedBy: updatedBy
          }, { merge: true });
        });
        break;

      case 'delete':
        try {
          await deleteAvailableStock(vegetable.id);
        } catch (error) {
          // If available stock doesn't exist, that's okay for deletion
          if (error.message && error.message.includes('not found')) {
          } else {
            throw error;
          }
        }
        break;
    }
  } catch (error) {
    console.error('Error syncing available stock with vegetables:', error);
    throw error;
  }
};
