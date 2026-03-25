import React, { useState, useMemo, useCallback } from 'react';
import type { Vegetable, BillItem, Bill, User } from '../../types/types';
import Button from './ui/Button.tsx';
import { PlusIcon, MinusIcon, MagnifyingGlassIcon, CheckCircleIcon } from './ui/Icon.tsx';
import CartView from './CartView.tsx';
import BillPreviewPage from './BillPreviewPage.tsx';
import VegetableFormModal from './VegetableFormModal';
import ImagePreviewModal from './ui/ImagePreviewModal';
import { getUserFromDb } from '../services/dbService';

interface CreateBillProps {
  user: User;
  vegetables: Vegetable[];
  bills: Bill[]; // Add bills to calculate available stock
  addBill: (newBill: Omit<Bill, 'id' | 'date'>) => Promise<Bill>;
  availableStock?: Map<string, number>;
}

type CreateBillStage = 'ordering' | 'success';

type CartItemDetails = BillItem & { name: string; pricePerKg: number; stockKg: number; unitType: 'KG' | 'COUNT'; };

const CreateBill: React.FC<CreateBillProps> = ({ user, vegetables, bills, addBill, availableStock }) => {
  const [stage, setStage] = useState<CreateBillStage>('ordering');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState('All');
  const [isCartVisible, setIsCartVisible] = useState(false);
  const [finalBill, setFinalBill] = useState<Bill | null>(null);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerIdError, setCustomerIdError] = useState('');
  const [isFetchingCustomer, setIsFetchingCustomer] = useState(false);
  const [bagCount, setBagCount] = useState(0);
  
  const BAG_PRICE = 10; // ₹10 per bag

  const vegetableMap = useMemo(() => new Map(vegetables.map(v => [v.id, v])), [vegetables]);

  // Calculate used stock for each vegetable from bills
  const usedStock = useMemo(() => {
    const used = new Map<string, number>();
    
    bills.forEach(bill => {
      bill.items?.forEach(item => {
        const currentUsed = used.get(item.vegetableId) || 0;
        used.set(item.vegetableId, currentUsed + item.quantityKg);
      });
    });
    
    return used;
  }, [bills]);

  // Calculate available stock for each vegetable.
  // Prefer shared availableStock map (from useBillingData) if provided; otherwise derive from totalStockKg minus used from bills.
  const getAvailableStock = useCallback((vegetable: Vegetable) => {
    if (availableStock && availableStock.has(vegetable.id)) {
      return Math.max(0, availableStock.get(vegetable.id) as number);
    }
    const used = usedStock.get(vegetable.id) || 0;
    return Math.max(0, vegetable.totalStockKg - used);
  }, [usedStock, availableStock]);

  const categories = useMemo(() => {
    const cats = ['All', ...new Set(vegetables.map(v => v.category))];
    return cats;
  }, [vegetables]);

  const filteredVegetables = useMemo(() => {
    let filtered = vegetables.filter(veg => 
      veg.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      (category === 'All' || veg.category === category)
    );
    
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
  }, [vegetables, searchTerm, category]);

  // Helpers to format qty and units consistently
  const formatQty = (qty: number, unitType: 'KG' | 'COUNT') => unitType === 'COUNT' ? Math.floor(qty).toString() : qty.toFixed(2);
  const formatUnit = (unitType: 'KG' | 'COUNT') => unitType === 'KG' ? 'kg' : 'pieces';

  const updateCart = useCallback((vegId: string, quantity: number) => {
    setCart(prev => {
      const newCart = new Map(prev);
      const vegetable = vegetableMap.get(vegId);
      if (!vegetable) return prev;

      // Normalize quantity per unit type to avoid float artifacts
      let q = quantity;
      if (vegetable.unitType === 'COUNT') {
        q = Math.floor(q);
      } else {
        q = parseFloat(q.toFixed(2));
      }

      if (q <= 0) {
        newCart.delete(vegId);
      } else {
        const available = getAvailableStock(vegetable);
        const clamped = Math.min(q, available);
        const finalQty = vegetable.unitType === 'COUNT' ? Math.floor(clamped) : parseFloat(clamped.toFixed(2));
        newCart.set(vegId, finalQty);
      }
      return newCart;
    });
  }, [vegetableMap, getAvailableStock]);

  const { cartItems, total, totalItems } = useMemo(() => {
    const items: CartItemDetails[] = [];
    let currentTotal = 0;
    let itemCount = 0;

    cart.forEach((quantity, vegId) => {
      const vegetable = vegetableMap.get(vegId);
      if (vegetable && quantity > 0) {
        const subtotal = quantity * vegetable.pricePerKg;
        items.push({
          vegetableId: vegId,
          quantityKg: quantity,
          subtotal,
          name: vegetable.name,
          pricePerKg: vegetable.pricePerKg,
          stockKg: vegetable.stockKg,
          unitType: vegetable.unitType
        });
        currentTotal += subtotal;
        itemCount++;
      }
    });

    // Add bag cost to total
    const bagsTotal = bagCount * BAG_PRICE;
    const finalTotal = currentTotal + bagsTotal;

    items.sort((a, b) => a.name.localeCompare(b.name));
    return { cartItems: items, total: finalTotal, totalItems: itemCount };
  }, [cart, vegetableMap, bagCount, BAG_PRICE]);

  const handleBagCountChange = (increment: boolean) => {
    setBagCount(prev => {
      const newCount = increment ? prev + 1 : Math.max(0, prev - 1);
      return newCount;
    });
  };

  const handleConfirmOrder = useCallback(async () => {
    if (!customerId.trim() || !customerName.trim()) {
      alert('Please enter a valid Customer ID and ensure name is fetched');
      return;
    }
    const createdBill = await addBill({
      items: cartItems.map(({name, pricePerKg, stockKg, unitType, ...item}) => item),
      total,
      customerName: customerName.trim(),
      customerId: customerId.trim(),
      status: 'pending',
      bags: bagCount,
    });
    setFinalBill(createdBill);
    setStage('success');
    setCart(new Map());
    setBagCount(0);
    setCustomerName('');
    setCustomerId('');
    setCustomerIdError('');
  }, [cartItems, total, addBill, customerName, customerId, bagCount]);

  const handlePlaceOrder = async () => {
      setIsCartVisible(false);
      setIsPlacingOrder(true);
      
      // Add a small delay for better UX
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      await handleConfirmOrder();
      setIsPlacingOrder(false);
  };

  const handleBackToOrdering = () => {
    setStage('ordering');
    setFinalBill(null);
  };

  if (stage === 'success' && finalBill) {
    return (
      <BillPreviewPage 
        bill={finalBill} 
        vegetables={vegetables}
        onLogout={handleBackToOrdering}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans relative">
      {/* Loading Overlay */}
      {isPlacingOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 text-center shadow-2xl transform animate-pulse">
            <div className="w-16 h-16 mx-auto mb-4 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Creating Bill</h3>
            <p className="text-slate-600">Please wait while we prepare the bill...</p>
          </div>
        </div>
      )}
      
      {/* Header */}
      <header className="bg-gradient-to-br from-blue-50 via-white to-green-50 shadow-sm border-b border-slate-200 px-4 py-3">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 bg-gradient-to-br from-green-500 to-green-600 rounded-md shadow-sm">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-blue-700 to-green-600 bg-clip-text text-transparent">
                  Create Bill
                </h1>
                <p className="text-slate-700 text-sm">Select items and create a new bill for customer</p>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-md border border-slate-200 p-4">
              <div className="flex items-center mb-3">
                <svg className="w-4 h-4 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <h3 className="text-base font-semibold text-slate-800">Customer Information</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Customer ID *</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={customerId}
                      onChange={async (e) => {
                          // Normalize input to uppercase so lookup is case-insensitive
                          const id = e.target.value.trim().toUpperCase();
                          setCustomerId(id);
                          setCustomerName('');
                          setCustomerIdError('');
                          if (id.length > 0) {
                            setIsFetchingCustomer(true);
                            const user = await getUserFromDb(id);
                            setIsFetchingCustomer(false);
                            let name = '';
                            if (user) {
                              if (typeof user['employee_name'] === 'string') {
                                name = user['employee_name'];
                              } else if (typeof user['name'] === 'string') {
                                name = user['name'];
                              } else {
                                // Fallback: use first string property except id
                                for (const key of Object.keys(user)) {
                                  if (typeof user[key] === 'string' && key !== 'id') {
                                    name = user[key];
                                    break;
                                  }
                                }
                              }
                            }
                            if (name) {
                              setCustomerName(name);
                              setCustomerIdError('');
                            } else {
                              setCustomerName('');
                              setCustomerIdError('Customer not found');
                            }
                          } else {
                            setCustomerName('');
                            setCustomerIdError('');
                          }
                        }}
                      placeholder="Enter customer ID"
                      className={`w-full px-4 py-2.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 font-mono ${
                        customerIdError ? 'border-red-300 bg-red-50' : 
                        customerName && !customerIdError ? 'border-green-300 bg-green-50' : 
                        'border-slate-300 bg-white'
                      } shadow-sm`}
                      required
                    />
                    {isFetchingCustomer && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      </div>
                    )}
                  </div>
                  {/* Fixed height container for status messages to prevent layout shift */}
                  <div className="h-5 mt-1">
                    {isFetchingCustomer && (
                      <div className="flex items-center text-xs text-blue-600">
                        <svg className="animate-spin -ml-1 mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Fetching customer...
                      </div>
                    )}
                    {customerIdError && (
                      <div className="flex items-center text-xs text-red-600">
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {customerIdError}
                      </div>
                    )}
                    {customerName && !customerIdError && (
                      <div className="flex items-center text-xs text-green-600">
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Customer found: {customerName}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Customer Name</label>
                  <input
                    type="text"
                    value={customerName}
                    readOnly
                    placeholder="Customer name will appear here"
                    className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-lg bg-slate-50 text-slate-700 shadow-sm cursor-not-allowed"
                    required
                  />
                  {/* Fixed height spacer to match the other column */}
                  <div className="h-5 mt-1"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex lg:flex-row overflow-hidden">
        {/* Product List */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 max-w-4xl mx-auto">
          <div className="mb-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <MagnifyingGlassIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                </div>
                <input
                  type="text"
                  placeholder="Search for vegetables..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="block w-full rounded-lg border-slate-300 bg-white pl-10 py-3 text-slate-900 focus:ring-primary-500 focus:border-primary-500 shadow-sm"
                />
              </div>
              <div className="sm:w-48">
                <select 
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="block w-full rounded-lg border-slate-300 bg-white py-3 px-3 text-slate-900 focus:ring-primary-500 focus:border-primary-500 shadow-sm"
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Product List */}
          <div className="space-y-3">
            {filteredVegetables.length > 0 ? filteredVegetables.map((veg, index) => {
              const quantity = cart.get(veg.id) || 0;
              const availableStock = getAvailableStock(veg);
              const isOutOfStock = availableStock <= 0;
              
              return (
                <div key={veg.id} className={`bg-white rounded-lg border p-4 transition-colors flex items-center justify-between ${isOutOfStock ? 'bg-slate-50 opacity-60' : 'hover:shadow-md border-slate-200'}`}>
                  <div className="flex items-center space-x-4">
                    <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-semibold text-sm">{index + 1}</div>
                    <div>
                      <h3 className="font-semibold text-slate-800 text-lg">{veg.name}</h3>
                      <p className="text-slate-600">₹{Number(veg.pricePerKg).toFixed(2)}/{veg.unitType === 'KG' ? 'kg' : 'piece'}</p>
                      {availableStock <= 0 && (
                        <p className="text-sm text-red-500 font-medium">Out of Stock</p>
                      )}
                      {availableStock > 0 && availableStock <= 5 && (
                        <p className="text-sm text-amber-600">
                          Low Stock: {formatQty(availableStock, veg.unitType)} {formatUnit(veg.unitType)} available
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    {isOutOfStock ? (
                      <span className="text-sm font-medium text-red-500 px-4 py-2">Unavailable</span>
                    ) : quantity > 0 ? (
                      <div className="flex items-center space-x-2">
                        <button 
                          onClick={() => {
                            const decrement = veg.unitType === 'COUNT' ? 1 : 0.25;
                            updateCart(veg.id, quantity - decrement);
                          }} 
                          className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50 flex items-center justify-center" 
                          disabled={quantity <= 0}
                        >
                          <MinusIcon className="h-4 w-4"/>
                        </button>
                        <input
                          type="number"
                          value={veg.unitType === 'COUNT' ? Math.floor(quantity) : parseFloat((quantity).toFixed(2))}
                          onChange={(e) => updateCart(veg.id, parseFloat(e.target.value) || 0)}
                          className="w-16 text-center font-bold text-slate-800 border border-slate-300 rounded px-2 py-1 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                          min="0"
                          max={availableStock}
                          step={veg.unitType === 'COUNT' ? "1" : "0.25"}
                          aria-label={`${veg.name} quantity in ${veg.unitType === 'KG' ? 'kg' : 'pieces'}`}
                        />
                        <button 
                          onClick={() => {
                            const increment = veg.unitType === 'COUNT' ? 1 : 0.25;
                            updateCart(veg.id, quantity + increment);
                          }} 
                          className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50 flex items-center justify-center" 
                          disabled={quantity >= availableStock}
                        >
                          <PlusIcon className="h-4 w-4"/>
                        </button>
                      </div>
                    ) : (
                      <Button 
                        onClick={() => {
                          const defaultQuantity = veg.unitType === 'COUNT' ? 1 : (veg.category === 'Greens' ? 0.25 : 1);
                          updateCart(veg.id, defaultQuantity);
                        }} 
                        className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium flex items-center"
                      >
                        <PlusIcon className="h-4 w-4 mr-2"/> Add
                      </Button>
                    )}
                  </div>
                </div>
              );
            }) : (
              <div className="text-center text-slate-500 py-10">
                <p className="text-lg">No vegetables found.</p>
                <p className="text-sm mt-2">Try adjusting your search or category filter.</p>
              </div>
            )}
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
                <p className="text-xl font-bold text-slate-800">₹{Number(total).toFixed(2)}</p>
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

export default CreateBill;