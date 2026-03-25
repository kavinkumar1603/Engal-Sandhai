import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Bill, User } from '../../types/types';
import { ArrowLeftIcon, XMarkIcon, CalendarIcon } from './ui/Icon.tsx';
import { fetchUserOrdersByDate } from '../services/dbService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface UserOrdersProps {
  user: User; // viewer (logged-in user)
  onLogout: () => void;
  // Optional: whose orders to fetch; defaults to `user.id` so this component
  // can be reused in admin to view a selected user's orders.
  targetUserId?: string;
}

// Order icon component
const OrderIcon: React.FC<{ status: string }> = ({ status }) => {
  const isDelivered = status?.toLowerCase() === 'delivered';
  
  return (
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
      isDelivered ? 'bg-green-100' : 'bg-yellow-100'
    }`}>
      <svg className={`w-6 h-6 ${isDelivered ? 'text-green-600' : 'text-yellow-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    </div>
  );
};

const UserOrders: React.FC<UserOrdersProps> = ({ user, onLogout, targetUserId }) => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [selectedOrder, setSelectedOrder] = useState<Bill | null>(null);
  const subjectUserId = targetUserId || user.id;
  const viewingOwnOrders = subjectUserId === user.id;
  const [subjectName, setSubjectName] = useState<string>(user.employee_name || user.name || 'User');
  const [subjectDept, setSubjectDept] = useState<string | undefined>((user as any).department);
  
  // Single date filter - set today's date as default
  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDate());
  const [showDatePicker, setShowDatePicker] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Safety check for user object
  if (!user || !user.id) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-xl font-semibold mb-4">User not found</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  const handleBack = () => {
    // If viewing own orders (no targetUserId), always go to user dashboard
    // This ensures '/my-orders' returns to the user's page only.
    if (!targetUserId) {
      navigate('/dashboard');
      return;
    }

    // When an admin is viewing a specific user's orders via admin route, go back to admin dashboard
    navigate('/admin/dashboard');
  };

  useEffect(() => {
    if (selectedDate) {
      loadOrdersForDate();
    }
  }, [selectedDate, subjectUserId]);

  const loadOrdersForDate = async () => {
    if (!selectedDate) return;
    
    try {
      setLoading(true);
      setError('');
      
      const date = new Date(selectedDate);
      
      const fetchedOrders = await fetchUserOrdersByDate(subjectUserId, date);

      // Fetch user details to get the correct name
      let correctName = subjectName;
      let correctDept = subjectDept;
      
      try {
        const userRef = doc(db, 'users', subjectUserId);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          // Prioritize employee_name, then name, then fallback to user.name
          const dbName = userData.employee_name || userData.name || userData.fullName || userData.displayName;
          if (dbName) correctName = dbName;
          
          const dbDept = userData.department || userData.dept || userData.departmentName;
          if (dbDept) correctDept = dbDept;
          
          setSubjectName(correctName || subjectName);
          setSubjectDept(correctDept || subjectDept);
        }
      } catch (userErr) {
        console.error('Error fetching user details:', userErr);
        // Continue with existing user.name
      }
      
      // Enrich orders with user information if missing or "Unknown"
      const enrichedOrders = fetchedOrders.map(order => {
        // Check if existing name is "Unknown Customer" or similar
        const isUnknown = !order.customerName || 
                          order.customerName === 'Unknown Customer' || 
                          order.customerName === 'Unknown' ||
                          order.customerName === 'unknown';
                          
        return {
          ...order,
          customerName: isUnknown ? correctName : order.customerName,
          department: order.department || correctDept,
        };
      });
      
      setOrders(enrichedOrders);
      
    } catch (err) {
      console.error('❌ Error loading orders:', err);
      setError('Failed to load orders. Please try again later.');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };



  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDateShort = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric' 
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
      'pending': { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Pending' },
      'inprogress': { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Progress' },
      'packed': { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Packed' },
      'bill_sent': { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Bill Sent' },
      'bill sent': { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Bill Sent' },
      'delivered': { bg: 'bg-green-100', text: 'text-green-700', label: 'Delivered' },
    };

    const config = statusConfig[status.toLowerCase()] || { bg: 'bg-gray-100', text: 'text-gray-700', label: status };
    
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  const filteredOrders = React.useMemo(() => {
    try {
      return orders;
    } catch (err) {
      console.error('Error filtering orders:', err);
      return orders;
    }
  }, [orders]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeftIcon className="h-6 w-6 text-gray-700" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">
            {viewingOwnOrders ? 'Your Orders' : `Orders for ${subjectName}`}
          </h1>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">{subjectName || 'User'}</span>
            <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
              <span className="text-primary-700 font-bold text-base">{(subjectName || 'U').charAt(0).toUpperCase()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Date Filter */}
        <div className="mb-4 flex items-center gap-3">
          <label className="bg-white border border-gray-300 rounded-lg px-4 py-3 flex items-center gap-2 hover:bg-gray-50 transition-colors shadow-sm cursor-pointer">
            <CalendarIcon className="h-5 w-5 text-gray-600" />
            <span className="text-sm text-gray-700 font-medium">Filter by Date</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="absolute opacity-0 w-0 h-0"
              onClick={(e) => e.currentTarget.showPicker?.()}
            />
          </label>
          
          {selectedDate && (
            <span className="px-4 py-3 bg-primary-50 text-primary-700 rounded-lg text-sm font-medium border border-primary-200">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>

        {/* Orders Content */}
        {!selectedDate ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <div className="text-6xl mb-4">📅</div>
            <p className="text-gray-800 text-xl font-semibold mb-2">Select a date to view orders</p>
            <p className="text-gray-500">Choose a date to see your orders for that day.</p>
          </div>
        ) : loading ? (
          <div className="flex flex-col justify-center items-center py-20">
            <div className="animate-spin rounded-full ray-50-16 border-b-4 border-primary-600 mb-4"></div>
            <p className="text-gray-600 font-medium">Loading orders...</p>
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl shadow-sm border border-red-200 p-12 text-center">
            <div className="text-red-600 text-5xl mb-4">⚠️</div>
            <p className="text-red-800 text-lg font-semibold mb-2">{error}</p>
            <button
              onClick={loadOrdersForDate}
              className="mt-4 px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <div className="text-6xl mb-4">📦</div>
            <p className="text-gray-800 text-xl font-semibold mb-2">No orders found</p>
            <p className="text-gray-500">No orders match your selected filters.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map((order) => {
              if (!order || !order.id) return null;
              
              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex gap-4">
                    {/* Order Icon */}
                    <OrderIcon status={order.status || 'pending'} />

                    <div className="flex-1">
                      {/* Header */}
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h3 className="text-lg font-bold text-gray-900">
                            {order.id || 'N/A'}
                          </h3>
                          <p className="text-sm text-gray-500">
                            {order.date ? new Date(order.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date N/A'}
                          </p>
                        </div>
                        {getStatusBadge(order.status || 'pending')}
                      </div>

                      {/* Items List */}
                      <div className="space-y-2 mb-3">
                        {(order.items || []).slice(0, 3).map((item, index) => (
                          <div key={index} className="flex justify-between items-center text-sm">
                            <span className="text-gray-700">
                              {item?.name || 'Unknown Item'} ({item?.quantityKg || 0}kg)
                            </span>
                            <span className="font-medium text-gray-900">₹{Math.round(item?.subtotal || 0)}</span>
                          </div>
                        ))}
                        
                        {(order.items || []).length > 3 && (
                          <div className="text-sm text-gray-500">
                            + {order.items.length - 3} more item{order.items.length - 3 > 1 ? 's' : ''}...
                          </div>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="flex justify-between items-center pt-3 border-t border-gray-200">
                        <span className="text-sm text-gray-600">Total: <span className="text-xl font-bold text-green-600">₹{Math.round(order.total || 0)}</span></span>
                        <button
                          onClick={() => setSelectedOrder(order)}
                          className="text-green-600 font-medium text-sm flex items-center gap-1 hover:text-green-700"
                        >
                          View Details
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Order Details Modal */}
      {selectedOrder && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedOrder(null)}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header - Blue */}
            <div style={{backgroundColor: '#14532d'}} className="px-6 py-5 relative">
              <button
                onClick={() => setSelectedOrder(null)}
                className="absolute left-4 top-4 text-white hover:bg-white/20 rounded-full p-2 transition-colors"
                aria-label="Close modal"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </button>
              <div className="text-center">
                <h2 className="text-2xl font-bold text-white">
                  {selectedOrder.id}
                </h2>
                <p className="text-sm text-white/90 mt-1">
                  {new Date(selectedOrder.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto max-h-[calc(90vh-280px)] px-6 py-5 bg-gray-50">
              {/* Buyer Name */}
              <div className="mb-5">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Buyer Name</h3>
                <p className="text-xl font-bold text-gray-900">{selectedOrder.customerName}</p>
              </div>

              {/* Items Ordered */}
              <div className="mb-5">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Items Ordered</h3>
                
                <div className="bg-white rounded-xl divide-y divide-gray-200">
                  {selectedOrder.items.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-4 p-4"
                    >
                      {/* Serial Number - No Background */}
                      <div className="w-12 flex items-center justify-center flex-shrink-0">
                        <span className="text-gray-700 font-bold text-2xl">{index + 1}</span>
                      </div>
                      
                      {/* Item Details */}
                      <div className="flex-1">
                        <p className="font-bold text-gray-900 text-base mb-1">
                          {item.name || 'Unknown Item'}
                        </p>
                        <p className="text-sm text-gray-500">
                          {item.quantityKg} kg × ₹{item.pricePerKg || 0}/kg
                        </p>
                      </div>
                      
                      {/* Price */}
                      <div className="text-right">
                        <p className="font-bold text-gray-900 text-lg">
                          ₹{Math.round(item.subtotal)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer - Totals */}
            <div className="border-t border-gray-200 px-6 py-5 bg-white">
              {/* Bags Count (if any) - only show if bags exist and are greater than 0 */}
              {selectedOrder.bags !== undefined && selectedOrder.bags !== null && Number(selectedOrder.bags) > 0 ? (
                <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-200">
                  <span className="text-gray-600">Bags ({selectedOrder.bags} × ₹10)</span>
                  <span className="font-semibold text-gray-900">
                    ₹{selectedOrder.bags * 10}
                  </span>
                </div>
              ) : null}
              
              {/* Grand Total */}
              <div className="flex justify-between items-center">
                <span className="text-xl font-bold text-gray-900">Grand Total</span>
                <span className="text-3xl font-bold text-green-600">
                  ₹{Math.round(selectedOrder.total)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserOrders;
