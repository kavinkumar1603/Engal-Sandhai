
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Vegetable, BillItem, Bill, User } from '../../types/types';
import UserHeader from './UserHeader.tsx';
import Button from './ui/Button.tsx';
import { PlusIcon, MinusIcon, MagnifyingGlassIcon } from './ui/Icon.tsx';
// COMMENTED OUT FOR NOW - Payment upload functionality preserved for future use
// import PaymentPage from './PaymentPage.tsx';
import CartView from './CartView.tsx';
import BillPreviewPage from './BillPreviewPage.tsx';
import UserSettings from './UserSettings.tsx';
import { updateUserNameInDb } from '../services/dbService';
import { roundTotal, formatRoundedTotal } from '../utils/roundUtils';
import { getOrderableStock } from '../../constants';

interface OrderPageProps {
  user: User;
  vegetables: Vegetable[];
  availableStock: Map<string, number>; // Real-time available stock from database
  addBill: (newBill: Omit<Bill, 'id' | 'date'>) => Promise<Bill>;
  onLogout: () => void;
  onUpdateUser?: (updatedUser: User) => void;
  loading?: boolean;
  onRefresh?: () => Promise<boolean>;
}

type OrderStage = 'ordering' | 'payment' | 'success' | 'settings';

// COMMENTED OUT - Base64 conversion utility preserved for future payment functionality
// Utility to convert file to base64
// const fileToBase64 = (file: File): Promise<string> => {
//     return new Promise((resolve, reject) => {
//         const reader = new FileReader();
//         reader.readAsDataURL(file);
//         reader.onload = () => resolve(reader.result as string);
//         reader.onerror = error => reject(error);
//     });
// };

type CartItemDetails = BillItem & { name: string; pricePerKg: number; stockKg: number; unitType: 'KG' | 'COUNT'; };

const OrderPage: React.FC<OrderPageProps> = ({ user, vegetables, availableStock, addBill, onLogout, onUpdateUser, loading = false, onRefresh }) => {
  const navigate = useNavigate();
  const [stage, setStage] = useState<OrderStage>('ordering');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState('All');
  const [isCartVisible, setIsCartVisible] = useState(false);
  const [finalBill, setFinalBill] = useState<Bill | null>(null);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [bagCount, setBagCount] = useState(0);
  const [stockValidationErrors, setStockValidationErrors] = useState<Map<string, { requested: number; available: number }>>(new Map());
  const [showStockAlert, setShowStockAlert] = useState(false);
  const [serverStockError, setServerStockError] = useState<string | null>(null);

  // Guard ref so we only attempt the explicit refresh once on initial mount.
  // This avoids a loop where the refresh doesn't populate vegetables and
  // the effect keeps firing on subsequent renders.
  const attemptedInitialRefresh = useRef(false);

  // Auto-refresh on mount if we have no vegetables yet
  useEffect(() => {
    if (!loading && vegetables.length === 0 && onRefresh && !attemptedInitialRefresh.current) {
      attemptedInitialRefresh.current = true;
      onRefresh().catch((e) => console.warn('OrderPage refresh failed:', e));
    }
  }, [loading, vegetables.length, onRefresh]);

  const BAG_PRICE = 10; // ₹10 per bag

  const vegetableMap = useMemo(() => new Map(vegetables.map(v => [v.id, v])), [vegetables]);
  const categories = useMemo(() => ['All', ...new Set(vegetables.map(v => v.category))], [vegetables]);

  const filteredVegetables = useMemo(() => {
    return vegetables.filter(v => {
      const matchesCategory = category === 'All' || v.category === category;
      const matchesSearch = v.name.toLowerCase().includes(searchTerm.toLowerCase());
      // Filter out vegetables with 0 orderable stock (maintains 15% reserve for KG items)
      const availableStockAmount = availableStock.get(v.id) || 0;
      const orderableStock = getOrderableStock(availableStockAmount, v.totalStockKg, v.unitType);
      const hasStock = orderableStock > 0;
      return matchesCategory && matchesSearch && hasStock;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [vegetables, searchTerm, category, availableStock]);

  const updateCart = (vegId: string, quantity: number) => {
    setCart(prev => {
      const newCart = new Map(prev);
      const vegetable = vegetableMap.get(vegId);
      if (!vegetable) {
        return prev;
      }

      // Use orderable stock for users (85% for KG items with 15% reserve, 100% for COUNT items)
      const availableStockAmount = availableStock.get(vegId) || 0;
      const maxStock = getOrderableStock(availableStockAmount, vegetable.totalStockKg, vegetable.unitType);
      // Clamp quantity between 0 and orderable stock
      const clampedQuantity = Math.max(0, Math.min(quantity, maxStock));

      if (clampedQuantity > 0) {
        newCart.set(vegId, parseFloat(clampedQuantity.toFixed(2)));
      } else {
        newCart.delete(vegId);
      }
      return newCart;
    });
  };

  const { cartItems, total, totalItems } = useMemo(() => {
    const items: CartItemDetails[] = [];
    let currentTotal = 0;
    let itemCount = 0;
    cart.forEach((quantity, vegId) => {
      const veg = vegetableMap.get(vegId);
      if (veg) {
        const subtotal = veg.pricePerKg * quantity;
        const availableStockAmount = availableStock.get(vegId) || 0;
        items.push({
          vegetableId: vegId,
          quantityKg: quantity,
          subtotal,
          name: veg.name,
          pricePerKg: veg.pricePerKg,
          stockKg: availableStockAmount,
          unitType: veg.unitType,
        });
        currentTotal += subtotal;
        itemCount += 1;
      }
    });

    // Add bag cost to total
    const bagsTotal = bagCount * BAG_PRICE;
    const finalTotal = currentTotal + bagsTotal;

    items.sort((a, b) => a.name.localeCompare(b.name));
    return { cartItems: items, total: roundTotal(finalTotal), totalItems: itemCount };
  }, [cart, vegetableMap, bagCount, BAG_PRICE, availableStock]);

  const handleBagCountChange = (increment: boolean) => {
    setBagCount(prev => {
      const newCount = increment ? prev + 1 : Math.max(0, prev - 1);
      return newCount;
    });
  };

  const handleConfirmOrder = useCallback(async () => {
    // COMMENTED OUT - Payment screenshot functionality preserved for future use
    // const paymentScreenshotBase64 = await fileToBase64(screenshot);


    const createdBill = await addBill({
      items: cartItems.map(({ name, pricePerKg, stockKg, unitType, ...item }) => item),
      total,
      customerName: user.name,
      customerId: user.id, // Add user ID so orders can be properly tracked
      department: (user as any).department, // Add department if available
      status: 'pending', // Default status for new orders
      bags: bagCount, // Include bags count
      // COMMENTED OUT - Payment screenshot field preserved for future use
      // paymentScreenshot: paymentScreenshotBase64,
    });

    setFinalBill(createdBill);
    setStage('success');
    setCart(new Map());
    setBagCount(0); // Reset bag count
  }, [cartItems, total, addBill, user.name, user.id, bagCount]);

  const handlePlaceOrder = async () => {
    setIsCartVisible(false);
    setIsPlacingOrder(true);
    setStockValidationErrors(new Map());
    setShowStockAlert(false);

    try {
      // Step 1: Real-time stock validation before order placement
      const errors = new Map<string, { requested: number; available: number }>();
      let hasStockIssues = false;

      for (const item of cartItems) {
        const currentStock = availableStock.get(item.vegetableId) || 0;
        const veg = vegetableMap.get(item.vegetableId);
        const orderableStock = veg ? getOrderableStock(currentStock, veg.totalStockKg, veg.unitType) : currentStock;
        if (orderableStock < item.quantityKg) {
          errors.set(item.vegetableId, {
            requested: item.quantityKg,
            available: orderableStock
          });
          hasStockIssues = true;
          console.warn(`❌ Insufficient stock for ${item.name}: requested ${item.quantityKg}kg, available ${orderableStock}kg (orderable)`);
        }
      }

      if (hasStockIssues) {
        setStockValidationErrors(errors);
        setShowStockAlert(true);
        setIsPlacingOrder(false);
        
        // Auto-adjust cart to orderable stock
        const adjustedCart = new Map(cart);
        errors.forEach((error, vegId) => {
          if (error.available > 0) {
            adjustedCart.set(vegId, error.available);
          } else {
            adjustedCart.delete(vegId);
          }
        });
        setCart(adjustedCart);
        
        // Show alert for 5 seconds
        setTimeout(() => setShowStockAlert(false), 5000);
        return;
      }


      // Add a small delay for better UX and animation visibility
      await new Promise(resolve => setTimeout(resolve, 1500));

      // COMMENTED OUT - Skip payment stage and go directly to success
      // setStage('payment');

      // Directly create the bill and go to success page
      // Note: addBill will use atomic transaction to reserve stock
      await handleConfirmOrder();
      setIsPlacingOrder(false);
    } catch (error: any) {
      console.error('❌ Order placement failed:', error);
      setIsPlacingOrder(false);
      
      // Check if it's a stock insufficiency error from the transaction
      if (error.message && error.message.includes('Insufficient stock')) {
        setServerStockError(error.message);
        // Refresh stock to get latest values
        if (onRefresh) {
          await onRefresh();
        }
      } else {
        setServerStockError('Order placement failed: ' + error.message);
      }
    }
  };

  const handleOpenSettings = () => {
    setStage('settings');
  };

  const handleUpdateProfile = async (profile: { name: string; email: string }) => {
    try {
      // Update the name in the database
      await updateUserNameInDb(user.id, profile.name);

      // Update the current user state if callback is provided
      if (onUpdateUser) {
        const updatedUser: User = {
          ...user,
          name: profile.name,
          email: profile.email
        };
        onUpdateUser(updatedUser);
      }

    } catch (error) {
      console.error('Error updating profile:', error);
      // You can add toast notification here for error handling
    }
  };

  const handleChangePassword = (passwords: { currentPassword: string; newPassword: string; confirmPassword: string }) => {
    // Convert all passwords to uppercase before processing
    const uppercasePasswords = {
      currentPassword: passwords.currentPassword.toUpperCase(),
      newPassword: passwords.newPassword.toUpperCase(),
      confirmPassword: passwords.confirmPassword.toUpperCase()
    };

    // Handle password change logic here
    // You can add API calls or validation here with uppercasePasswords
  };

  // COMMENTED OUT - Payment page functionality preserved for future use
  // if (stage === 'payment') {
  //   return <PaymentPage total={total} onConfirmOrder={handleConfirmOrder} onBack={() => setStage('ordering')} />;
  // }

  if (stage === 'success' && finalBill) {
    return (
      <BillPreviewPage
        bill={finalBill}
        vegetables={vegetables}
        onLogout={onLogout}
      />
    );
  }

  if (stage === 'settings') {
    return (
      <div className="min-h-screen bg-slate-100">
        <UserHeader user={user} onLogout={onLogout} />
        <div className="p-4">
          <button
            onClick={() => setStage('ordering')}
            className="mb-4 text-primary-600 hover:text-primary-700 font-medium"
          >
            ← Back to Shopping
          </button>
          <UserSettings user={user} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans relative">
      {/* Server-Side Stock Error Notification */}
      {serverStockError && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[60] w-11/12 max-w-md">
          <div className="bg-white border border-red-300 rounded-lg shadow-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <h4 className="font-semibold text-slate-800 text-sm mb-2">Stock Updated</h4>
                <div className="text-xs text-slate-600 space-y-1">
                  {(() => {
                    const lines = serverStockError.split('\n');
                    return lines.map((line, idx) => {
                      // Parse the error message
                      const match = line.match(/Insufficient stock for "(.+)": requested (.+?)(kg|count), only (.+?)(kg|count) available/);
                      if (match) {
                        const [, itemName, requested, , available] = match;
                        return (
                          <div key={idx} className="bg-slate-50 rounded p-2 border border-slate-200">
                            <div className="font-medium text-slate-700">{itemName}</div>
                            <div className="text-slate-500 mt-0.5">
                              You wanted <span className="font-semibold text-red-600">{requested}kg</span>, only <span className="font-semibold text-green-600">{available}kg</span> left
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }).filter(Boolean);
                  })()}
                </div>
                <p className="text-xs text-slate-500 mt-2">Please check your cart and try again</p>
              </div>
              <button onClick={() => setServerStockError(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock Alert Notification */}
      {showStockAlert && stockValidationErrors.size > 0 && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[60] w-11/12 max-w-md">
          <div className="bg-white border border-orange-300 rounded-lg shadow-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <h4 className="font-semibold text-slate-800 text-sm mb-2">Stock Adjusted</h4>
                <div className="space-y-2 text-xs">
                  {Array.from(stockValidationErrors.entries()).map(([vegId, error]) => {
                    const vegName = vegetables.find(v => v.id === vegId)?.name || 'Unknown';
                    return (
                      <div key={vegId} className="bg-slate-50 rounded p-2 border border-slate-200">
                        <div className="font-medium text-slate-700">{vegName}</div>
                        <div className="text-slate-500 mt-0.5">
                          You wanted <span className="font-semibold text-orange-600">{error.requested}kg</span>, only <span className="font-semibold text-green-600">{error.available}kg</span> available
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500 mt-2">Quantities updated to available stock</p>
              </div>
              <button onClick={() => setShowStockAlert(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Loading Overlay */}
      {(isPlacingOrder || loading) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 text-center shadow-2xl transform animate-pulse">
            <div className="w-16 h-16 mx-auto mb-4 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">{isPlacingOrder ? 'Processing Your Order' : 'Loading Data'}</h3>
            <p className="text-slate-600">{isPlacingOrder ? 'Please wait while we prepare your order...' : 'Fetching latest items...'}</p>
          </div>
        </div>
      )}

      <UserHeader user={user} onLogout={onLogout} onOpenSettings={handleOpenSettings} />
      <div className="flex-1 flex lg:flex-row overflow-hidden">{/* Product List */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24">
          <div className="mb-4">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <MagnifyingGlassIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
              </div>
              <input
                type="text"
                placeholder="Search for vegetables..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full rounded-md border-slate-300 bg-white pl-10 py-2.5 text-slate-900 focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              />
            </div>
            <div className="mt-3">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="block w-full rounded-md border-slate-300 bg-white py-2.5 text-slate-900 focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              >
                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-3">
            {filteredVegetables.length > 0 ? filteredVegetables.map((veg, index) => {
              const quantity = cart.get(veg.id) || 0;
              const availableStockAmount = availableStock.get(veg.id) || 0;
              const orderableStock = getOrderableStock(availableStockAmount, veg.totalStockKg, veg.unitType);
              return (
                <div key={veg.id} className="flex items-center justify-between p-3 bg-white rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-semibold text-sm mr-3">{index + 1}</div>
                    <div>
                      <p className="font-semibold text-slate-800">{veg.name}</p>
                      <p className="text-sm text-slate-500">₹{veg.pricePerKg.toFixed(2)}/{veg.unitType === 'KG' ? 'kg' : 'piece'}</p>
                    </div>
                  </div>
                  {quantity > 0 ? (
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          const decrement = veg.unitType === 'COUNT' ? 1 : 0.25;
                          updateCart(veg.id, quantity - decrement);
                        }}
                        className="p-2 rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                        disabled={quantity <= 0}
                      >
                        <MinusIcon className="h-4 w-4" />
                      </button>
                      <input
                        type="number"
                        value={veg.unitType === 'COUNT' ? quantity.toFixed(0) : quantity}
                        onChange={(e) => updateCart(veg.id, parseFloat(e.target.value) || 0)}
                        className="w-16 text-center font-bold text-primary-700 border-b-2 border-slate-300 focus:outline-none focus:border-primary-500 transition bg-transparent"
                        min="0"
                        max={orderableStock}
                        step={veg.unitType === 'COUNT' ? "1" : "0.25"}
                        aria-label={`${veg.name} quantity in ${veg.unitType === 'KG' ? 'kg' : 'pieces'}`}
                      />
                      <button
                        onClick={() => {
                          const increment = veg.unitType === 'COUNT' ? 1 : 0.25;
                          updateCart(veg.id, quantity + increment);
                        }}
                        className="p-2 rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                        disabled={quantity >= orderableStock}
                      >
                        <PlusIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <Button
                      onClick={() => {
                        const defaultQuantity = veg.unitType === 'COUNT' ? 1 : (veg.category === 'Greens' ? 0.25 : 1);
                        updateCart(veg.id, defaultQuantity);
                      }}
                      size="md"
                      className="px-3 py-1.5 text-sm"
                    >
                      <PlusIcon className="h-4 w-4 mr-1" /> Add
                    </Button>
                  )}
                </div>
              )
            }) : <p className="text-center text-slate-500 py-10">No vegetables found.</p>}
          </div>
        </main>

        {/* Desktop Cart Summary */}
        <aside className="hidden lg:flex lg:w-2/5 xl:w-1/3 bg-white border-l border-slate-200 flex-col">
          <CartView
            isDesktop={true}
            cartItems={cartItems}
            total={total}
            bagCount={bagCount}
            onBagCountChange={handleBagCountChange}
            onUpdateCart={updateCart}
            onPlaceOrder={handlePlaceOrder}
            isPlacingOrder={isPlacingOrder}
          />
        </aside>
      </div>

      {/* Mobile Sticky Footer */}
      <footer className={`lg:hidden fixed bottom-0 left-0 right-0 bg-white p-3 border-t border-slate-200 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] transform transition-transform duration-300 ease-in-out ${cartItems.length > 0 ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500">{totalItems} {totalItems > 1 ? 'ITEMS' : 'ITEM'}</span>
            <p className="text-xl font-bold text-slate-800">{formatRoundedTotal(total)}</p>
          </div>
          <Button
            onClick={() => setIsCartVisible(true)}
            size="md"
            className="relative overflow-hidden transition-all duration-300 transform hover:scale-105 hover:shadow-lg animate-bounce"
          >
            <span>View Order</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-0 hover:opacity-20 transform -skew-x-12 transition-all duration-1000 hover:translate-x-full"></div>
          </Button>
        </div>
      </footer>

      {/* Mobile Cart Sheet */}
      <CartView
        isOpen={isCartVisible}
        onClose={() => setIsCartVisible(false)}
        cartItems={cartItems}
        total={total}
        bagCount={bagCount}
        onBagCountChange={handleBagCountChange}
        onUpdateCart={updateCart}
        onPlaceOrder={handlePlaceOrder}
        isPlacingOrder={isPlacingOrder}
      />
    </div>
  );
};

export default OrderPage;