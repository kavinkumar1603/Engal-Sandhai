import { db } from '../firebase';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  where,
  limit,
  Timestamp,
  writeBatch,
  serverTimestamp,
  runTransaction,
  setDoc,
  increment,
} from 'firebase/firestore';
import type { Vegetable } from '../../types/types';
import type { Bill, BillItem } from '../../types/types';
import { round } from '../utils/mathUtils';

// Utility function to get date key (YYYY-MM-DD format)
export const getDateKey = (date?: Date): string => {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Date-based collections
const getVegetablesCol = (date?: Date) => collection(db, 'vegetables', getDateKey(date), 'items');
const getAvailableStockCol = (date?: Date) => collection(db, 'availableStock', getDateKey(date), 'items');

const vegetablesCol = collection(db, 'vegetables');

// Helper function to get date-based collection name
// Date-based collections for orders (matching inventory pattern)
export const getOrdersCol = (date?: Date) => collection(db, 'orders', getDateKey(date), 'items');

// Legacy function for backward compatibility
export const getOrdersCollectionName = (date?: Date): string => {
  const targetDate = date || new Date();
  const year = targetDate.getFullYear();
  const month = (targetDate.getMonth() + 1).toString().padStart(2, '0');
  const day = targetDate.getDate().toString().padStart(2, '0');
  return `orders-${year}-${month}-${day}`;
};

export const subscribeToVegetables = (
  onChange: (vegetables: Vegetable[]) => void,
  date?: Date
) => {
  // Use date-based collection for new items, fallback to regular collection for existing data
  const isDateBased = date !== undefined;
  const targetCol = isDateBased ? getVegetablesCol(date) : vegetablesCol;

  const q = query(targetCol, orderBy('name'));
  return onSnapshot(q, (snapshot) => {
    const items: Vegetable[] = snapshot.docs.map((d) => {
      const data = d.data() as Omit<Vegetable, 'id'>;
      return {
        id: d.id,
        name: data.name,
        unitType: data.unitType || 'KG', // Default to KG for existing items
        pricePerKg: Number(data.pricePerKg) || 0,
        totalStockKg: Number(data.totalStockKg) || Number(data.stockKg) || 0, // Fallback for existing data
        stockKg: Number(data.stockKg) || 0,
        category: data.category,
      };
    });
    onChange(items);
  });
};

export const addVegetableToDb = async (
  vegetable: Omit<Vegetable, 'id'>,
  date?: Date
): Promise<string> => {
  const dateKey = getDateKey(date);
  const vegetablesCol = getVegetablesCol(date);

  // Check for duplicate vegetable name in the same date collection
  const q = query(vegetablesCol, where('name', '==', vegetable.name));
  const querySnapshot = await getDocs(q);

  if (!querySnapshot.empty) {
    console.warn(`Duplicate found: ${vegetable.name}`);
    throw new Error(`Vegetable "${vegetable.name}" already exists.`);
  }

  const docRef = await addDoc(vegetablesCol, {
    name: vegetable.name,
    unitType: vegetable.unitType,
    pricePerKg: vegetable.pricePerKg,
    totalStockKg: vegetable.totalStockKg,
    stockKg: vegetable.stockKg,
    category: vegetable.category,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    dateKey: dateKey, // Add date tracking
  });

  // Sync with date-based availableStock collection for real-time stock tracking
  try {
    const availableStockRef = doc(db, 'availableStock', dateKey, 'items', docRef.id);
    await setDoc(availableStockRef, {
      productId: docRef.id,
      productName: vegetable.name,
      category: vegetable.category,
      pricePerKg: vegetable.pricePerKg,
      totalStockKg: vegetable.totalStockKg,
      availableStockKg: vegetable.totalStockKg, // Initialize available = total
      unitType: vegetable.unitType || 'KG',
      lastUpdated: serverTimestamp(),
      updatedBy: 'system',
      dateKey: dateKey
    });
  } catch (error) {
    console.error('❌ Failed to create available stock entry:', error);
  }

  return docRef.id;
};

export const updateVegetableInDb = async (vegetable: Vegetable, date?: Date, isAddMode?: boolean): Promise<void> => {
  const dateKey = getDateKey(date);
  const isDateBased = date !== undefined;

  // Update vegetables collection (date-based if date provided, regular otherwise)
  const ref = isDateBased
    ? doc(db, 'vegetables', dateKey, 'items', vegetable.id)
    : doc(db, 'vegetables', vegetable.id);

  await updateDoc(ref, {
    name: vegetable.name,
    unitType: vegetable.unitType,
    pricePerKg: vegetable.pricePerKg,
    totalStockKg: vegetable.totalStockKg,
    stockKg: vegetable.stockKg,
    category: vegetable.category,
    updatedAt: serverTimestamp(),
    ...(isDateBased && { dateKey })
  });

  // Sync with availableStock collection
  try {
    const availableStockRef = isDateBased
      ? doc(db, 'availableStock', dateKey, 'items', vegetable.id)
      : doc(db, 'availableStock', vegetable.id);

    await runTransaction(db, async (transaction) => {
      const stockDoc = await transaction.get(availableStockRef);
      let newAvailable = vegetable.totalStockKg;


      if (stockDoc.exists()) {
        const currentData = stockDoc.data();
        
        if (isAddMode) {
          // ADD mode: Calculate the difference and add to available stock
          const diff = vegetable.totalStockKg - (currentData.totalStockKg || 0);
          newAvailable = Math.max(0, (currentData.availableStockKg || 0) + diff);
        } else {
          // SET mode: Set both totalStock and availableStock to the new value
          newAvailable = vegetable.totalStockKg;
        }
      }

      // CRITICAL FIX: Ensure availableStock can NEVER exceed totalStock
      if (newAvailable > vegetable.totalStockKg) {
        console.warn('[updateVegetableInDb] CLAMPING availableStock from', newAvailable, 'to', vegetable.totalStockKg);
        newAvailable = vegetable.totalStockKg;
      }

      transaction.set(availableStockRef, {
        productName: vegetable.name,
        category: vegetable.category,
        pricePerKg: vegetable.pricePerKg,
        totalStockKg: vegetable.totalStockKg,
        availableStockKg: newAvailable,
        unitType: vegetable.unitType || 'KG',
        lastUpdated: serverTimestamp(),
        updatedBy: 'system',
        ...(isDateBased && { dateKey })
      }, { merge: true });
    });
    const target = isDateBased ? `${vegetable.name} on ${dateKey}` : vegetable.name;
    const mode = isAddMode ? 'ADD' : 'SET';
  } catch (error) {
    console.error('❌ Failed to update available stock:', error);
  }
};

export const deleteVegetableFromDb = async (vegId: string, date?: Date): Promise<void> => {
  const dateKey = getDateKey(date);
  const isDateBased = date !== undefined;

  // Delete from vegetables collection (date-based if date provided, regular otherwise)
  const ref = isDateBased
    ? doc(db, 'vegetables', dateKey, 'items', vegId)
    : doc(db, 'vegetables', vegId);

  await deleteDoc(ref);

  // Delete from availableStock collection
  try {
    const availableStockRef = isDateBased
      ? doc(db, 'availableStock', dateKey, 'items', vegId)
      : doc(db, 'availableStock', vegId);

    await deleteDoc(availableStockRef);
    const target = isDateBased ? `vegetable on ${dateKey}` : 'vegetable';
  } catch (error) {
    console.error('❌ Failed to delete available stock:', error);
  }
};

// Function to reduce stock when items are ordered
export const reduceVegetableStock = async (vegetableId: string, quantityToReduce: number, date?: Date): Promise<void> => {
  const dateKey = getDateKey(date);
  const isDateBased = date !== undefined;

  try {
    // Get current vegetable data
    const ref = isDateBased
      ? doc(db, 'vegetables', dateKey, 'items', vegetableId)
      : doc(db, 'vegetables', vegetableId);

    const docSnap = await getDoc(ref);
    if (!docSnap.exists()) {
      console.error(`Vegetable not found: ${vegetableId}`);
      return;
    }

    const currentVegetable = docSnap.data() as Vegetable;
    const newStockKg = Math.max(0, round(currentVegetable.stockKg - quantityToReduce));


    // Update vegetables collection
    await updateDoc(ref, {
      stockKg: increment(-quantityToReduce),
      updatedAt: serverTimestamp()
    });

    // Also update availableStock collection
    try {
      const availableStockRef = isDateBased
        ? doc(db, 'availableStock', dateKey, 'items', vegetableId)
        : doc(db, 'availableStock', vegetableId);

      await updateDoc(availableStockRef, {
        availableStockKg: increment(-quantityToReduce),
        lastUpdated: serverTimestamp(),
        updatedBy: 'order-system'
      });

      const target = isDateBased ? `${currentVegetable.name} on ${dateKey}` : currentVegetable.name;
    } catch (error) {
      console.error('❌ Failed to update available stock during reduction:', error);
    }

  } catch (error) {
    console.error('❌ Error reducing vegetable stock:', error);
    throw error;
  }
};

// Batch function to reduce stock for multiple items
export const batchReduceVegetableStock = async (
  items: Array<{ vegetableId: string; quantityToReduce: number }>,
  date?: Date
): Promise<void> => {

  try {
    // Process all stock reductions
    const promises = items.map(item =>
      reduceVegetableStock(item.vegetableId, item.quantityToReduce, date)
    );

    await Promise.all(promises);
  } catch (error) {
    console.error('❌ Error in batch stock reduction:', error);
    throw error;
  }
};

// User-related functions
export const updateUserNameInDb = async (userId: string, name: string): Promise<void> => {
  const ref = doc(db, 'users', userId);
  await updateDoc(ref, {
    name: name,
    updatedAt: new Date(),
  });
};

export const getUserFromDb = async (userId: string) => {
  const ref = doc(db, 'users', userId);
  const docSnap = await getDoc(ref);
  if (docSnap.exists()) {
    return { ...docSnap.data(), id: userId };
  }
  return null;
};

// Place order function that stores in date-based collection
export interface OrderData {
  bagCost: number;
  bagCount: number;
  cartSubtotal: number;
  employee_id: string;
  items: {
    id: string;
    name: string;
    pricePerKg: number;
    quantity: number;
    subtotal: number;
  }[];
  // Added new statuses: 'inprogress' and 'bill_sent'
  status: 'pending' | 'packed' | 'delivered' | 'inprogress' | 'bill_sent';
  totalAmount: number;
  userId: string;
  customerName?: string; // Add customer name
  customerId?: string;   // Add customer ID
  department?: string;   // Add department field
}

// Global order processing queue to prevent concurrent order placement
let orderProcessingQueue = Promise.resolve();
let isProcessingOrder = false;

// Function to get the current processing status
export const getOrderProcessingStatus = () => isProcessingOrder;

export const placeOrder = async (orderData: OrderData): Promise<string> => {

  // Add this order to the processing queue to prevent race conditions
  return new Promise((resolve, reject) => {
    orderProcessingQueue = orderProcessingQueue
      .then(async () => {
        try {
          isProcessingOrder = true;

          // Add a small delay to ensure sequential processing
          await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

          const result = await processOrderInternal(orderData);
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          isProcessingOrder = false;
        }
      })
      .catch((error) => {
        isProcessingOrder = false;
        reject(error);
      });
  });
};

// Internal order processing function - ATOMIC TRANSACTION to prevent stock overselling
const processOrderInternal = async (orderData: OrderData): Promise<string> => {

  const today = new Date();
  const dateKey = getDateKey(today);
  const isLegacyDate = dateKey === '2025-09-24' || dateKey === '2025-09-25';

  // Use legacy collection for Sept 24-25, new subcollection format for others
  let ordersCollectionRef: any;
  let collectionName: string;

  if (isLegacyDate) {
    ordersCollectionRef = collection(db, 'orders');
    collectionName = 'orders (legacy)';
  } else {
    ordersCollectionRef = getOrdersCol(today);
    collectionName = `orders/${dateKey}/items`;
  }


  // Get current bill counter info
  const day = today.getDate().toString().padStart(2, '0');
  const month = (today.getMonth() + 1).toString().padStart(2, '0');
  const year = today.getFullYear();
  const counterKey = `${year}${month}${day}`;
  const counterRef = doc(db, 'bill_counters', counterKey);

  // Prepare sanitized order data
  const sanitizedOrderData = Object.fromEntries(
    Object.entries(orderData).filter(([key, value]) => value !== undefined)
  );

  // Round monetary values for safety
  if (sanitizedOrderData.totalAmount) {
    sanitizedOrderData.totalAmount = round(sanitizedOrderData.totalAmount as number);
  }
  if (sanitizedOrderData.cartSubtotal) {
    sanitizedOrderData.cartSubtotal = round(sanitizedOrderData.cartSubtotal as number);
  }
  if (sanitizedOrderData.items && Array.isArray(sanitizedOrderData.items)) {
    sanitizedOrderData.items = (sanitizedOrderData.items as any[]).map(item => ({
      ...item,
      quantity: round(item.quantity),
      subtotal: round(item.subtotal)
    }));
  }

  // Execute ATOMIC TRANSACTION: stock check + reservation + order creation
  const billNumber = await runTransaction(db, async (transaction) => {

    // Step 1: Get and increment bill counter
    const counterDoc = await transaction.get(counterRef);
    const counter = counterDoc.exists() ? (counterDoc.data().counter || 0) + 1 : 1;
    const generatedBillNumber = `ES${day}${month}${year}-${counter.toString().padStart(3, '0')}`;
    

    // Step 2: Verify stock availability for ALL items (FIFO - first to check gets priority)
    const stockErrors: string[] = [];
    const stockRefs: { vegRef: any; availStockRef: any; itemId: string; quantity: number; itemName: string }[] = [];

    for (const item of orderData.items) {
      const vegRef = doc(db, 'vegetables', dateKey, 'items', item.id);
      const availStockRef = doc(db, 'availableStock', dateKey, 'items', item.id);
      
      const vegDoc = await transaction.get(vegRef);
      const availStockDoc = await transaction.get(availStockRef);

      if (!vegDoc.exists()) {
        stockErrors.push(`Vegetable "${item.name}" not found in database`);
        continue;
      }

      if (!availStockDoc.exists()) {
        stockErrors.push(`Stock information not available for "${item.name}"`);
        continue;
      }

      const currentStock = availStockDoc.data().availableStockKg || 0;
      
      if (currentStock < item.quantity) {
        stockErrors.push(
          `Insufficient stock for "${item.name}": requested ${item.quantity}kg, only ${currentStock}kg available`
        );
      } else {
        // Store refs for later update (only if stock is sufficient)
        stockRefs.push({
          vegRef,
          availStockRef,
          itemId: item.id,
          quantity: item.quantity,
          itemName: item.name
        });
      }
    }

    // If ANY item has insufficient stock, abort entire transaction
    if (stockErrors.length > 0) {
      const errorMsg = `Stock validation failed:\n${stockErrors.join('\n')}`;
      console.error('❌ Transaction aborted - stock insufficient:', errorMsg);
      throw new Error(errorMsg);
    }


    // Step 3: Reserve stock by decrementing (atomic operation within transaction)
    for (const { vegRef, availStockRef, itemId, quantity, itemName } of stockRefs) {
      
      transaction.update(vegRef, {
        stockKg: increment(-quantity),
        updatedAt: serverTimestamp()
      });

      transaction.update(availStockRef, {
        availableStockKg: increment(-quantity),
        lastUpdated: serverTimestamp(),
        updatedBy: orderData.userId
      });
    }

    // Step 4: Create order document
    const orderDocRef = doc(ordersCollectionRef, generatedBillNumber);
    const newOrder = {
      ...sanitizedOrderData,
      orderId: generatedBillNumber,
      billNumber: generatedBillNumber,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      dateKey: dateKey,
      customerName: orderData.customerName || 'Unknown Customer',
      customerId: orderData.customerId || 'unknown',
      userId: orderData.userId || 'unknown'
    };

    transaction.set(orderDocRef, newOrder);

    // Step 5: Update counter
    transaction.set(counterRef, {
      counter,
      lastUpdated: serverTimestamp()
    }, { merge: true });

    return generatedBillNumber;
  });

  return billNumber;
};

// Async stock update function (runs in background) - now supports date-based collections
const updateStockAsync = async (orderData: OrderData, billNumber: string, orderDate?: Date) => {
  try {
    const stockBatch = writeBatch(db);
    let stockUpdateCount = 0;

    // Always use date-based collections since that's how vegetables are stored now
    const targetDate = orderDate || new Date();
    const dateKey = getDateKey(targetDate);

    for (const item of orderData.items) {

      try {
        // Update vegetables collection (always date-based now)
        const vegRef = doc(db, 'vegetables', dateKey, 'items', item.id);
        const vegDoc = await getDoc(vegRef);

        if (vegDoc.exists()) {

          stockBatch.update(vegRef, {
            stockKg: increment(-item.quantity),
            updatedAt: serverTimestamp()
          });
          stockUpdateCount++;
        } else {
          console.warn(`❌ Vegetable ${item.id} not found in date ${dateKey} - cannot update stock`);
        }

        // Update available stock (always date-based now)
        const availableStockRef = doc(db, 'availableStock', dateKey, 'items', item.id);
        const availableStockDoc = await getDoc(availableStockRef);

        if (availableStockDoc.exists()) {

          stockBatch.update(availableStockRef, {
            availableStockKg: increment(-item.quantity),
            lastUpdated: serverTimestamp(),
            updatedBy: orderData.userId
          });
          stockUpdateCount++;
        } else {
          console.warn(`❌ Available stock not found for vegetable ${item.id} on ${dateKey}`);
        }

      } catch (itemError) {
        console.error(`Error processing stock for item ${item.id}:`, itemError);
      }
    }

    // Commit stock updates if we have any
    if (stockUpdateCount > 0) {
      await stockBatch.commit();
    }

  } catch (stockError) {
    console.error(`Stock update failed for order ${billNumber}:`, stockError);
    // This doesn't affect the order which was already created successfully
  }
};


// Orders subscription for today's orders (uses legacy collection for Sept 24-25, date-based for others)
export const subscribeToTodayOrders = (
  onChange: (bills: Bill[]) => void
) => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

  // Check if today is September 24th or 25th, 2025 - use legacy collection only
  const isLegacyDate = todayStr === '2025-09-24' || todayStr === '2025-09-25';

  if (isLegacyDate) {
    // Subscribe only to legacy orders collection for Sept 24-25
    const legacyOrdersCol = collection(db, 'orders');
    const legacyQuery = query(
      legacyOrdersCol,
      where('createdAt', '>=', new Date(todayStr + 'T00:00:00')),
      where('createdAt', '<', new Date(todayStr + 'T23:59:59')),
      orderBy('createdAt', 'desc')
    );

    return onSnapshot(legacyQuery, (snapshot) => {
      const bills: Bill[] = snapshot.docs.map((docSnapshot) => {
        const orderData = docSnapshot.data();
        const createdAt = orderData.createdAt?.toDate ? orderData.createdAt.toDate() : (orderData.createdAt || new Date());


        const items: BillItem[] = Array.isArray(orderData.items)
          ? orderData.items.map((it: any, index: number) => {

            // Try multiple possible field combinations for legacy compatibility
            const vegetableId = it.id || it.vegetableId || it.product_id || it.productId || `unknown-${index}`;
            const quantityKg = Number(it.quantity || it.quantityKg || it.qty || it.weight || it.amount) || 0;
            const subtotal = Number(it.subtotal || it.total || it.price || it.cost) || 0;

            return {
              vegetableId,
              quantityKg,
              subtotal,
            };
          })
          : [];

        if (items.length === 0 && orderData.items) {
          console.warn(`⚠️ No items processed for order ${docSnapshot.id}, original items:`, orderData.items);
        }
        const bill: Bill = {
          id: String(orderData.billNumber || orderData.orderId || docSnapshot.id),
          date: new Date(createdAt).toISOString(),
          items,
          total: Number(orderData.totalAmount) || 0,
          customerName: String(orderData.customerName || orderData.userId || orderData.employee_id || 'Unknown'),
          department: orderData.department || undefined, // Add department from order data
          status: (orderData.status as Bill['status']) || 'pending',
          bags: Number(orderData.bagCount || orderData.bags || 0) || undefined,
        };
        (bill as any).customerId = String(orderData.customerId || orderData.userId || orderData.employee_id || '');
        return bill;
      });
      onChange(bills);
    }, (error) => {
      console.error('Error subscribing to legacy orders:', error);
      onChange([]);
    });
  }

  // For all other dates, use new date-based subcollection format
  const ordersCollectionRef = getOrdersCol(today);
  const q = query(ordersCollectionRef, orderBy('createdAt', 'desc'));

  return onSnapshot(q, (snapshot) => {
    const bills: Bill[] = snapshot.docs.map((docSnapshot) => {
      const orderData = docSnapshot.data();
      const createdAt = orderData.createdAt?.toDate ? orderData.createdAt.toDate() : (orderData.createdAt || new Date());
      const items: BillItem[] = Array.isArray(orderData.items)
        ? orderData.items.map((it: any) => {
          const billItem: any = {
            vegetableId: it.id,
            quantityKg: Number(it.quantity) || 0,
            subtotal: Number(it.subtotal) || 0,
          };
          // Preserve historical data for PDF generation
          if (it.name) billItem.name = it.name;
          if (it.pricePerKg) billItem.pricePerKg = Number(it.pricePerKg);
          return billItem;
        })
        : [];
      const bill: Bill = {
        id: String(orderData.billNumber || orderData.orderId || docSnapshot.id),
        date: new Date(createdAt).toISOString(),
        items,
        total: Number(orderData.totalAmount) || 0,
        customerName: String(orderData.customerName || orderData.userId || orderData.employee_id || 'Unknown'),
        department: orderData.department || undefined, // Add department from order data
        status: (orderData.status as Bill['status']) || 'pending',
        bags: Number(orderData.bagCount || orderData.bags || 0) || undefined,
      };
      (bill as any).customerId = String(orderData.customerId || orderData.userId || orderData.employee_id || '');
      return bill;
    });
    onChange(bills);
  }, (error) => {
    console.error('Error subscribing to date-based orders:', error);
    onChange([]);
  });
};

// Orders subscription for specific date
// Orders subscription for specific date (uses legacy collection for Sept 24-25, date-based for others)
export const subscribeToDateOrders = (
  date: Date,
  onChange: (bills: Bill[]) => void
) => {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD format

  // Check if date is September 24th or 25th, 2025 - use legacy collection only
  const isLegacyDate = dateStr === '2025-09-24' || dateStr === '2025-09-25';

  if (isLegacyDate) {
    // Subscribe only to legacy orders collection for Sept 24-25
    const legacyOrdersCol = collection(db, 'orders');
    const legacyQuery = query(
      legacyOrdersCol,
      where('createdAt', '>=', new Date(dateStr + 'T00:00:00')),
      where('createdAt', '<', new Date(dateStr + 'T23:59:59')),
      orderBy('createdAt', 'desc')
    );

    return onSnapshot(legacyQuery, (snapshot) => {
      const bills: Bill[] = snapshot.docs.map((docSnapshot) => {
        const orderData = docSnapshot.data();
        const createdAt = orderData.createdAt?.toDate ? orderData.createdAt.toDate() : (orderData.createdAt || new Date());


        const items: BillItem[] = Array.isArray(orderData.items)
          ? orderData.items.map((it: any, index: number) => {

            // Try multiple possible field combinations for legacy compatibility
            const vegetableId = it.id || it.vegetableId || it.product_id || it.productId || `unknown-${index}`;
            const quantityKg = Number(it.quantity || it.quantityKg || it.qty || it.weight || it.amount) || 0;
            const subtotal = Number(it.subtotal || it.total || it.price || it.cost) || 0;

            return {
              vegetableId,
              quantityKg,
              subtotal,
            };
          })
          : [];

        if (items.length === 0 && orderData.items) {
          console.warn(`⚠️ No items processed for order ${docSnapshot.id}, original items:`, orderData.items);
        }
        const bill: Bill = {
          id: String(orderData.billNumber || orderData.orderId || docSnapshot.id),
          date: new Date(createdAt).toISOString(),
          items,
          total: Number(orderData.totalAmount) || 0,
          customerName: String(orderData.customerName || orderData.userId || orderData.employee_id || 'Unknown'),
          department: orderData.department || undefined, // Add department from order data
          status: (orderData.status as Bill['status']) || 'pending',
          bags: Number(orderData.bagCount || orderData.bags || 0) || undefined,
        };
        (bill as any).customerId = String(orderData.customerId || orderData.userId || orderData.employee_id || '');
        return bill;
      });
      onChange(bills);
    }, (error) => {
      console.error('Error subscribing to legacy orders:', error);
      onChange([]);
    });
  }

  // For all other dates, use new date-based subcollection format
  const ordersCollectionRef = getOrdersCol(date);
  const q = query(ordersCollectionRef, orderBy('createdAt', 'desc'));

  return onSnapshot(q, (snapshot) => {
    const bills: Bill[] = snapshot.docs.map((docSnapshot) => {
      const orderData = docSnapshot.data();
      const createdAt = orderData.createdAt?.toDate ? orderData.createdAt.toDate() : (orderData.createdAt || new Date());
      const items: BillItem[] = Array.isArray(orderData.items)
        ? orderData.items.map((it: any) => {
          const billItem: any = {
            vegetableId: it.id,
            quantityKg: Number(it.quantity) || 0,
            subtotal: Number(it.subtotal) || 0,
          };
          // Preserve historical data for PDF generation
          if (it.name) billItem.name = it.name;
          if (it.pricePerKg) billItem.pricePerKg = Number(it.pricePerKg);
          return billItem;
        })
        : [];
      const bill: Bill = {
        id: String(orderData.billNumber || orderData.orderId || docSnapshot.id),
        date: new Date(createdAt).toISOString(),
        items,
        total: Number(orderData.totalAmount) || 0,
        customerName: String(orderData.customerName || orderData.userId || orderData.employee_id || 'Unknown'),
        department: orderData.department || undefined, // Add department from order data
        status: (orderData.status as Bill['status']) || 'pending',
        bags: Number(orderData.bagCount || orderData.bags || 0) || undefined,
      };
      (bill as any).customerId = String(orderData.customerId || orderData.userId || orderData.employee_id || '');
      return bill;
    });
    onChange(bills);
  }, (error) => {
    console.error('Error subscribing to date-based orders:', error);
    onChange([]);
  });
};

// Legacy function - keep for backward compatibility, but now uses today's collection
export const subscribeToOrders = (
  onChange: (bills: Bill[]) => void
) => {
  return subscribeToTodayOrders(onChange);
};

/**
 * Searches for an order across multiple date-based collections by orderId
 * This is needed for bill status updates since we don't know which date collection the order is in
 * Special handling: Sept 24-25 orders are in legacy 'orders' collection, others in date-based collections
 */
export async function findOrderByOrderId(orderId: string): Promise<{ docId: string; collectionName: string; data: any } | null> {
  // First, try searching in the legacy orders collection (for Sept 24-25 and any other legacy orders)
  try {
    const legacyOrderRef = doc(db, 'orders', orderId);
    const legacyDoc = await getDoc(legacyOrderRef);
    if (legacyDoc.exists()) {
      return {
        docId: orderId,
        collectionName: 'orders',
        data: legacyDoc.data()
      };
    }
  } catch (error) {
  }

  // Then try searching in date-based collections from the last 30 days (excluding Sept 24-25)
  const searchDays = 30;
  const today = new Date();

  for (let i = 0; i < searchDays; i++) {
    const searchDate = new Date(today);
    searchDate.setDate(today.getDate() - i);
    const searchDateStr = searchDate.toISOString().split('T')[0];

    // Skip Sept 24-25 as they are in legacy collection
    if (searchDateStr === '2025-09-24' || searchDateStr === '2025-09-25') {
      continue;
    }

    const collectionName = getOrdersCollectionName(searchDate);
    const orderDocRef = doc(db, collectionName, orderId);

    try {
      const docSnap = await getDoc(orderDocRef);
      if (docSnap.exists()) {
        return {
          docId: orderId,
          collectionName,
          data: docSnap.data()
        };
      }
    } catch (error) {
      // Document might not exist for this date, continue searching
    }
  }

  return null;
}

/**
 * Updates order status by orderId across date-based collections AND legacy orders collection
 * Now works with individual order documents within date-based collections and legacy orders
 */
export async function updateOrderStatus(
  orderId: string,
  status: 'pending' | 'packed' | 'delivered' | 'inprogress' | 'bill_sent',
  employeeId: string,
  targetDateOverride?: Date | null // Optional date override for UI date selection
): Promise<boolean> {
  try {
    const dateOverrideInfo = targetDateOverride ? ` (using selected date: ${getDateKey(targetDateOverride)})` : '';

    let targetDate: Date | null = targetDateOverride || null;

    // If no date override provided, extract date from orderId (ES28092025-001)
    if (!targetDate && orderId.startsWith('ES')) {
      const dateMatch = orderId.match(/ES(\d{2})(\d{2})(\d{4})-\d{3}/);
      if (dateMatch) {
        const [, day, month, year] = dateMatch;
        targetDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      }
    }

    // If no date extracted, use current date as fallback
    if (!targetDate) {
      targetDate = new Date();
    }

    const dateKey = getDateKey(targetDate);
    const isLegacyDate = dateKey === '2025-09-24' || dateKey === '2025-09-25';

    let orderDocRef: any;
    let collectionInfo: string;

    if (isLegacyDate) {
      // Update in legacy orders collection
      orderDocRef = doc(db, 'orders', orderId);
      collectionInfo = 'orders (legacy)';
    } else {
      // Update in date-based subcollection
      orderDocRef = doc(db, 'orders', dateKey, 'items', orderId);
      collectionInfo = `orders/${dateKey}/items`;
    }


    // Check if order exists
    const orderDoc = await getDoc(orderDocRef);
    if (!orderDoc.exists()) {
      console.warn(`❌ Order not found: ${orderId} in ${collectionInfo}`);

      // For debugging: try to find the order in other places
      if (isLegacyDate) {

        // Try searching by billNumber field instead of document ID
        const legacyOrdersCol = collection(db, 'orders');
        const billNumberQuery = query(legacyOrdersCol, where('billNumber', '==', orderId));
        const billNumberSnapshot = await getDocs(billNumberQuery);

        if (!billNumberSnapshot.empty) {
          const foundDoc = billNumberSnapshot.docs[0];

          // Update the orderDocRef to use the correct document ID
          orderDocRef = doc(db, 'orders', foundDoc.id);
        } else {
          // Also try searching by orderId field
          const orderIdQuery = query(legacyOrdersCol, where('orderId', '==', orderId));
          const orderIdSnapshot = await getDocs(orderIdQuery);

          if (!orderIdSnapshot.empty) {
            const foundDoc = orderIdSnapshot.docs[0];

            // Update the orderDocRef to use the correct document ID
            orderDocRef = doc(db, 'orders', foundDoc.id);
          } else {
            return false;
          }
        }

        // Try to get the document again with the updated reference
        const retryOrderDoc = await getDoc(orderDocRef);
        if (!retryOrderDoc.exists()) {
          return false;
        }
      } else {
        return false;
      }
    }

    // Get the existing order data to understand its structure
    const existingData = orderDoc.data();
    const currentStatus = (existingData as any)?.status || 'unknown';

    // Update the order status (different structure for legacy vs new orders)
    if (isLegacyDate) {
      // Legacy orders: simpler update structure
      try {
        await updateDoc(orderDocRef, {
          status,
          updatedAt: serverTimestamp(),
          employeeId, // Add employeeId directly for legacy orders
        });
      } catch (updateError) {
        console.error(`❌ Failed to update legacy order ${orderId}:`, updateError);

        // Try alternative update - maybe legacy orders have different field names
        try {
          await updateDoc(orderDocRef, {
            status,
            updatedAt: serverTimestamp(),
          });
        } catch (altUpdateError) {
          console.error(`❌ Alternative update also failed for ${orderId}:`, altUpdateError);
          throw altUpdateError;
        }
      }
    } else {
      // New date-based orders: more complex structure
      try {
        await updateDoc(orderDocRef, {
          status,
          updatedAt: serverTimestamp(),
          bill: {
            billId: orderId,
            employeeId,
            status,
            updatedAt: serverTimestamp(),
          }
        });
      } catch (updateError) {
        console.error(`❌ Failed to update date-based order ${orderId}:`, updateError);
        throw updateError;
      }
    }

    return true;

  } catch (error) {
    console.error(`❌ Failed to update order status for ${orderId}:`, error);
    return false;
  }
}

// Debug function to inspect legacy orders structure
export const debugLegacyOrders = async (): Promise<void> => {
  try {
    const legacyOrdersCol = collection(db, 'orders');
    const legacyQuery = query(legacyOrdersCol, limit(5)); // Get first 5 orders
    const snapshot = await getDocs(legacyQuery);

    if (snapshot.empty) {
    } else {
      snapshot.docs.forEach((doc, index) => {
        const data = doc.data();
      });
    }
  } catch (error) {
    console.error('❌ Error inspecting legacy orders:', error);
  }
};

// Function to fetch individual vegetable data by ID across all date collections
export const getVegetableById = async (vegetableId: string): Promise<Vegetable | null> => {
  try {

    // First, try legacy vegetables collection (for Sept 24-25 and other legacy data)
    try {
      const legacyVegRef = doc(db, 'vegetables', vegetableId);
      const legacyVegDoc = await getDoc(legacyVegRef);
      if (legacyVegDoc.exists()) {
        const data = legacyVegDoc.data();
        return {
          id: legacyVegDoc.id,
          name: data.name || 'Unknown',
          unitType: (data.unitType as 'KG' | 'COUNT') || 'KG',
          pricePerKg: Number(data.pricePerKg || data.price) || 0,
          totalStockKg: Number(data.totalStockKg || data.stock || data.totalStock) || 0,
          stockKg: Number(data.stockKg || data.availableStock) || 0,
          category: data.category || 'Other',
        };
      }
    } catch (error) {
    }

    // Search in date-based collections (last 60 days)
    const searchDays = 60;
    const today = new Date();

    for (let i = 0; i < searchDays; i++) {
      const searchDate = new Date(today);
      searchDate.setDate(today.getDate() - i);
      const dateKey = getDateKey(searchDate);

      try {
        const dateBasedVegRef = doc(db, 'vegetables', dateKey, 'items', vegetableId);
        const dateBasedVegDoc = await getDoc(dateBasedVegRef);

        if (dateBasedVegDoc.exists()) {
          const data = dateBasedVegDoc.data();
          return {
            id: dateBasedVegDoc.id,
            name: data.name || 'Unknown',
            unitType: (data.unitType as 'KG' | 'COUNT') || 'KG',
            pricePerKg: Number(data.pricePerKg || data.price) || 0,
            totalStockKg: Number(data.totalStockKg || data.stock || data.totalStock) || 0,
            stockKg: Number(data.stockKg || data.availableStock) || 0,
            category: data.category || 'Other',
          };
        }
      } catch (error) {
        // Continue searching other dates
        continue;
      }
    }

    return null;
  } catch (error) {
    console.error(`Error searching for vegetable ${vegetableId}:`, error);
    return null;
  }
};

// Available Stock subscription
export const subscribeToAvailableStock = (
  onChange: (availableStock: Map<string, number>) => void,
  date?: Date
) => {
  // Use date-based collection for new items, fallback to regular collection for existing data
  const isDateBased = date !== undefined;
  const availableStockCol = isDateBased
    ? getAvailableStockCol(date)
    : collection(db, 'availableStock');

  const q = query(availableStockCol, orderBy('lastUpdated', 'desc'));

  return onSnapshot(q, (snapshot) => {
    const availableStockMap = new Map<string, number>();
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      availableStockMap.set(data.productId, data.availableStockKg || 0);
    });
    onChange(availableStockMap);
  }, (error) => {
    const dateInfo = isDateBased ? ` for ${getDateKey(date)}` : '';
    console.error(`Error subscribing to available stock${dateInfo}:`, error);
    onChange(new Map());
  });
};

// Batch update multiple order statuses
export const updateMultipleOrderStatuses = async (
  updates: Array<{ billNumber: string; status: 'pending' | 'packed' | 'delivered' | 'inprogress' | 'bill_sent'; employeeId: string }>,
  targetDateOverride?: Date | null // Optional date override for UI date selection
): Promise<void> => {
  try {

    const batch = writeBatch(db);

    for (const update of updates) {
      const { billNumber, status, employeeId } = update;

      let targetDate: Date | null = targetDateOverride || null;

      // If no date override provided, extract date from billNumber
      if (!targetDate && billNumber.startsWith('ES')) {
        const dateMatch = billNumber.match(/ES(\d{2})(\d{2})(\d{4})-\d{3}/);
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          targetDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        }
      }
      if (!targetDate) targetDate = new Date();

      const dateKey = getDateKey(targetDate);
      const isLegacyDate = dateKey === '2025-09-24' || dateKey === '2025-09-25';

      // Get order document reference
      const orderDocRef = isLegacyDate
        ? doc(db, 'orders', billNumber)
        : doc(db, 'orders', dateKey, 'items', billNumber);

      // Add to batch (different structure for legacy vs new orders)
      if (isLegacyDate) {
        // Legacy orders: simpler update structure
        batch.update(orderDocRef, {
          status: status,
          updatedAt: serverTimestamp(),
          employeeId, // Add employeeId directly for legacy orders
        });
      } else {
        // New date-based orders: more complex structure
        batch.update(orderDocRef, {
          status: status,
          updatedAt: serverTimestamp(),
          bill: {
            billId: billNumber,
            employeeId,
            status,
            updatedAt: serverTimestamp(),
          }
        });
      }
    }

    // Commit batch update
    await batch.commit();

  } catch (error) {
    console.error(`❌ Failed to batch update order statuses:`, error);
    throw error;
  }
};

/**
 * Fetch bills for a date range (e.g., weekly report)
 * This is more efficient than multiple subscriptions
 */
export const fetchBillsForDateRange = async (
  startDate: Date,
  endDate: Date
): Promise<Bill[]> => {
  const allBills: Bill[] = [];

  // Generate all dates in the range
  const dates: Date[] = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Fetch bills for each date
  for (const date of dates) {
    const dateStr = date.toISOString().split('T')[0];
    const isLegacyDate = dateStr === '2025-09-24' || dateStr === '2025-09-25';

    try {
      if (isLegacyDate) {
        // Fetch from legacy collection for Sept 24-25
        const legacyOrdersCol = collection(db, 'orders');
        const legacyQuery = query(
          legacyOrdersCol,
          where('createdAt', '>=', new Date(dateStr + 'T00:00:00')),
          where('createdAt', '<', new Date(dateStr + 'T23:59:59')),
          orderBy('createdAt', 'desc')
        );

        const snapshot = await getDocs(legacyQuery);
        const dayBills = snapshot.docs.map((docSnapshot) => {
          const orderData = docSnapshot.data();
          const createdAt = orderData.createdAt?.toDate ? orderData.createdAt.toDate() : (orderData.createdAt || new Date());
          const items = Array.isArray(orderData.items)
            ? orderData.items.map((it: any) => ({
              vegetableId: it.id,
              quantityKg: Number(it.quantity) || 0,
              subtotal: Number(it.subtotal) || 0,
            }))
            : [];

          const bill: Bill = {
            id: String(orderData.billNumber || orderData.orderId || docSnapshot.id),
            date: new Date(createdAt).toISOString(),
            items,
            total: Number(orderData.totalAmount) || 0,
            customerName: String(orderData.userId || orderData.employee_id || 'Unknown'),
            department: orderData.department || undefined, // Add department from order data
            status: (orderData.status as Bill['status']) || 'pending',
            bags: Number(orderData.bagCount || orderData.bags || 0) || undefined,
          };
          (bill as any).customerId = String(orderData.userId || orderData.employee_id || '');
          return bill;
        });

        allBills.push(...dayBills);
      } else {
        // Fetch from date-based collection
        const ordersCollectionRef = getOrdersCol(date);
        const q = query(ordersCollectionRef, orderBy('createdAt', 'desc'));

        const snapshot = await getDocs(q);
        const dayBills = snapshot.docs.map((docSnapshot) => {
          const orderData = docSnapshot.data();
          const createdAt = orderData.createdAt?.toDate ? orderData.createdAt.toDate() : (orderData.createdAt || new Date());
          const items = Array.isArray(orderData.items)
            ? orderData.items.map((it: any) => ({
              vegetableId: it.id,
              quantityKg: Number(it.quantity) || 0,
              subtotal: Number(it.subtotal) || 0,
            }))
            : [];

          const bill: Bill = {
            id: String(orderData.billNumber || orderData.orderId || docSnapshot.id),
            date: new Date(createdAt).toISOString(),
            items,
            total: Number(orderData.totalAmount) || 0,
            customerName: String(orderData.userId || orderData.employee_id || 'Unknown'),
            status: (orderData.status as Bill['status']) || 'pending',
            bags: Number(orderData.bagCount || orderData.bags || 0) || undefined,
            department: String(orderData.department || ''),
          };
          (bill as any).customerId = String(orderData.userId || orderData.employee_id || '');
          return bill;
        });

        allBills.push(...dayBills);
      }
    } catch (error) {
      console.warn(`Failed to fetch bills for date ${dateStr}:`, error);
      // Continue with other dates even if one fails
    }
  }

  // Sort all bills by date descending
  return allBills.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

/**
 * Fetch vegetables for a specific date
 * This is useful for getting historical stock information
 */
export const fetchVegetablesForDate = async (date?: Date): Promise<Vegetable[]> => {
  try {
    const isDateBased = date !== undefined;
    const targetCol = isDateBased ? getVegetablesCol(date) : vegetablesCol;

    const q = query(targetCol, orderBy('name'));
    const snapshot = await getDocs(q);

    const items: Vegetable[] = snapshot.docs.map((d) => {
      const data = d.data() as Omit<Vegetable, 'id'>;
      return {
        id: d.id,
        name: data.name,
        unitType: data.unitType || 'KG',
        pricePerKg: Number(data.pricePerKg) || 0,
        totalStockKg: Number(data.totalStockKg) || Number(data.stockKg) || 0,
        stockKg: Number(data.stockKg) || 0,
        category: data.category,
      };
    });

    return items;
  } catch (error) {
    console.error('Error fetching vegetables for date:', error);
    return [];
  }
};

/**
 * Update bill/order with new data (items, total, etc.)
 * Handles both legacy and date-based collections
 */
export const updateBill = async (
  billId: string,
  updates: Partial<Bill>,
  targetDate?: Date
): Promise<void> => {
  try {

    let targetBillDate: Date;

    // If target date provided, use it; otherwise extract from billId or use current date
    if (targetDate) {
      targetBillDate = targetDate;
    } else if (billId.startsWith('ES')) {
      // Extract date from bill number format: ES28092025-001
      const dateMatch = billId.match(/ES(\d{2})(\d{2})(\d{4})-\d{3}/);
      if (dateMatch) {
        const [, day, month, year] = dateMatch;
        targetBillDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else {
        targetBillDate = new Date();
      }
    } else {
      targetBillDate = new Date();
    }

    const dateKey = getDateKey(targetBillDate);
    const isLegacyDate = dateKey === '2025-09-24' || dateKey === '2025-09-25';

    let billDocRef: any;
    let collectionInfo: string;

    if (isLegacyDate) {
      // Update in legacy orders collection
      billDocRef = doc(db, 'orders', billId);
      collectionInfo = 'orders (legacy)';
    } else {
      // Update in date-based subcollection
      billDocRef = doc(db, 'orders', dateKey, 'items', billId);
      collectionInfo = `orders/${dateKey}/items`;
    }


    // Check if bill exists
    const billDoc = await getDoc(billDocRef);
    if (!billDoc.exists()) {
      console.warn(`❌ Bill not found: ${billId} in ${collectionInfo}`);

      // For legacy bills, try to find by billNumber or orderId field
      if (isLegacyDate) {
        const legacyOrdersCol = collection(db, 'orders');
        const billNumberQuery = query(legacyOrdersCol, where('billNumber', '==', billId));
        const billNumberSnapshot = await getDocs(billNumberQuery);

        if (!billNumberSnapshot.empty) {
          const foundDoc = billNumberSnapshot.docs[0];
          billDocRef = doc(db, 'orders', foundDoc.id);
        } else {
          // Also try searching by orderId field
          const orderIdQuery = query(legacyOrdersCol, where('orderId', '==', billId));
          const orderIdSnapshot = await getDocs(orderIdQuery);

          if (!orderIdSnapshot.empty) {
            const foundDoc = orderIdSnapshot.docs[0];
            billDocRef = doc(db, 'orders', foundDoc.id);
          } else {
            throw new Error(`Bill ${billId} not found in ${collectionInfo}`);
          }
        }
      } else {
        throw new Error(`Bill ${billId} not found in ${collectionInfo}`);
      }
    }

    // Prepare update data based on collection type
    const updateData: any = {
      updatedAt: serverTimestamp()
    };

    // Map Bill updates to database fields
    if (updates.items !== undefined) {
      // Convert BillItem[] back to order items format
      updateData.items = updates.items.map(item => ({
        id: item.vegetableId,
        quantity: item.quantityKg,
        subtotal: item.subtotal,
        // Preserve additional data if available
        ...(item.name && { name: item.name }),
        ...(item.pricePerKg && { pricePerKg: item.pricePerKg })
      }));
    }

    if (updates.total !== undefined) {
      updateData.totalAmount = updates.total;
    }

    if (updates.status !== undefined) {
      updateData.status = updates.status;
    }

    if (updates.bags !== undefined) {
      updateData.bagCount = updates.bags;
      updateData.bags = updates.bags;
    }

    if (updates.customerName !== undefined) {
      updateData.customerName = updates.customerName;
    }

    if (updates.department !== undefined) {
      updateData.department = updates.department;
    }

    // Perform the update
    await updateDoc(billDocRef, updateData);


  } catch (error) {
    console.error(`❌ Failed to update bill ${billId}:`, error);
    throw error;
  }
};

/**
 * Fetches orders for a specific user/customer on a specific date
 * @param customerId - The unique ID of the customer
 * @param date - The date to fetch orders for (Date object)
 * @returns Promise with array of Bill objects
 */
export const fetchUserOrdersByDate = async (customerId: string, date: Date): Promise<Bill[]> => {
  if (!customerId) {
    console.error('❌ fetchUserOrdersByDate: customerId is required');
    return [];
  }

  const allOrders: Bill[] = [];
  const vegetableCache = new Map<string, Vegetable>();

  try {
    const dateKey = getDateKey(date);

    // Search in date-based collection for the specific date
    try {
      const ordersCol = collection(db, 'orders', dateKey, 'items');
      const ordersQuery = query(
        ordersCol,
        where('customerId', '==', customerId)
      );
      const orderDocs = await getDocs(ordersQuery);

      // If no results with customerId, try userId (legacy field name)
      if (orderDocs.empty) {
        const userIdQuery = query(
          ordersCol,
          where('userId', '==', customerId)
        );
        const userIdDocs = await getDocs(userIdQuery);

        userIdDocs.forEach((doc) => {
          const data = doc.data();
          const bill: Bill = {
            id: doc.id,
            date: data.createdAt?.toDate?.()?.toISOString() || data.date || new Date().toISOString(),
            customerName: data.customerName || '',
            customerId: data.customerId || data.userId || customerId,
            items: (data.items || []).map((item: any) => ({
              vegetableId: item.id || item.vegetableId || '',
              quantityKg: item.quantity || item.quantityKg || 0,
              pricePerKg: item.pricePerKg || 0,
              subtotal: item.subtotal || 0,
              name: item.name || '',
            })),
            total: data.totalAmount || data.total || 0,
            status: data.status || 'pending',
            bags: data.bagCount || data.bags || 0,
            department: data.department,
          };
          allOrders.push(bill);
        });
      } else {
        orderDocs.forEach((doc) => {
          const data = doc.data();
          const bill: Bill = {
            id: doc.id,
            date: data.createdAt?.toDate?.()?.toISOString() || data.date || new Date().toISOString(),
            customerName: data.customerName || '',
            customerId: data.customerId || data.userId || customerId,
            items: (data.items || []).map((item: any) => ({
              vegetableId: item.id || item.vegetableId || '',
              quantityKg: item.quantity || item.quantityKg || 0,
              pricePerKg: item.pricePerKg || 0,
              subtotal: item.subtotal || 0,
              name: item.name || '',
            })),
            total: data.totalAmount || data.total || 0,
            status: data.status || 'pending',
            bags: data.bagCount || data.bags || 0,
            department: data.department,
          };
          allOrders.push(bill);
        });
      }
    } catch (error: any) {
    }

    // Also check legacy 'orders' collection for the same date
    try {
      const legacyOrdersCol = collection(db, 'orders');
      const legacyQuery = query(
        legacyOrdersCol,
        where('customerId', '==', customerId)
      );
      const legacyDocs = await getDocs(legacyQuery);

      // Filter by date and try userId if needed
      legacyDocs.forEach((doc) => {
        const data = doc.data();
        const orderDate = data.createdAt?.toDate?.() || (data.date ? new Date(data.date) : null);

        // Only include orders from the selected date
        if (orderDate && getDateKey(orderDate) === dateKey) {
          const bill: Bill = {
            id: doc.id,
            date: data.createdAt?.toDate?.()?.toISOString() || data.date || new Date().toISOString(),
            customerName: data.customerName || '',
            customerId: data.customerId || data.userId || customerId,
            items: (data.items || []).map((item: any) => ({
              vegetableId: item.id || item.vegetableId || '',
              quantityKg: item.quantity || item.quantityKg || 0,
              pricePerKg: item.pricePerKg || 0,
              subtotal: item.subtotal || 0,
              name: item.name || '',
            })),
            total: data.totalAmount || data.total || 0,
            status: data.status || 'pending',
            bags: data.bagCount || data.bags || 0,
            department: data.department,
          };
          allOrders.push(bill);
        }
      });

      // Try userId if no results
      if (legacyDocs.empty) {
        const userIdQuery = query(
          legacyOrdersCol,
          where('userId', '==', customerId)
        );
        const userIdDocs = await getDocs(userIdQuery);

        userIdDocs.forEach((doc) => {
          const data = doc.data();
          const orderDate = data.createdAt?.toDate?.() || (data.date ? new Date(data.date) : null);

          // Only include orders from the selected date
          if (orderDate && getDateKey(orderDate) === dateKey) {
            const bill: Bill = {
              id: doc.id,
              date: data.createdAt?.toDate?.()?.toISOString() || data.date || new Date().toISOString(),
              customerName: data.customerName || '',
              customerId: data.customerId || data.userId || customerId,
              items: (data.items || []).map((item: any) => ({
                vegetableId: item.id || item.vegetableId || '',
                quantityKg: item.quantity || item.quantityKg || 0,
                pricePerKg: item.pricePerKg || 0,
                subtotal: item.subtotal || 0,
                name: item.name || '',
              })),
              total: data.totalAmount || data.total || 0,
              status: data.status || 'pending',
              bags: data.bagCount || data.bags || 0,
              department: data.department,
            };
            allOrders.push(bill);
          }
        });
      }
    } catch (error: any) {
    }

    // Enrich orders with vegetable names if missing
    const missingVegetableIds = new Set<string>();
    allOrders.forEach(order => {
      order.items.forEach(item => {
        if (!item.name && item.vegetableId) {
          missingVegetableIds.add(item.vegetableId);
        }
      });
    });

    // Fetch missing vegetable names
    if (missingVegetableIds.size > 0) {
      const vegetablePromises = Array.from(missingVegetableIds).map(async (vegId) => {
        try {
          const vegetable = await getVegetableById(vegId);
          if (vegetable) {
            vegetableCache.set(vegId, vegetable);
          }
        } catch (error) {
          console.warn(`Failed to fetch vegetable ${vegId}:`, error);
        }
      });

      await Promise.all(vegetablePromises);

      // Enrich orders with vegetable names
      allOrders.forEach(order => {
        order.items = order.items.map(item => {
          if (!item.name && item.vegetableId) {
            const vegetable = vegetableCache.get(item.vegetableId);
            if (vegetable) {
              return {
                ...item,
                name: vegetable.name,
                pricePerKg: item.pricePerKg || vegetable.pricePerKg,
              };
            }
          }
          return item;
        });
      });
    }

    // Filter orders by allowed statuses only
    const allowedStatuses = ['packed', 'delivered', 'bill sent', 'bill_sent'];
    const filteredOrders = allOrders.filter(order => {
      const status = order.status?.toLowerCase();
      return allowedStatuses.includes(status);
    });

    // Sort orders by date (newest first)
    filteredOrders.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });


    if (filteredOrders.length === 0 && allOrders.length > 0) {
    } else if (allOrders.length === 0) {
    }

    return filteredOrders;
  } catch (error) {
    console.error('❌ Error fetching user orders:', error);
    throw error;
  }
};