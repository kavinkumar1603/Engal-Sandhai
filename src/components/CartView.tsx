import React from "react";
import type { BillItem } from "../../types/types";
import Button from "./ui/Button.tsx";
import {
  ShoppingCartIcon,
  XMarkIcon,
  MinusIcon,
  PlusIcon,
  CheckCircleIcon,
  TrashIcon,
} from "./ui/Icon.tsx";


type CartItemDetails = BillItem & {
  name: string;
  pricePerKg: number;
  stockKg: number;
  unitType: "KG" | "COUNT";
};

interface CartViewProps {
  isOpen?: boolean;
  isDesktop?: boolean;
  onClose?: () => void;
  onPlaceOrder: () => Promise<void>;
  cartItems: CartItemDetails[];
  total: number;
  bagCount?: number;
  onBagCountChange?: (increment: boolean) => void;
  onUpdateCart: (vegId: string, quantity: number) => void;
  isPlacingOrder?: boolean;
}

const CartContent: React.FC<Omit<CartViewProps, "isOpen">> = ({
  cartItems,
  total,
  bagCount = 0,
  onBagCountChange,
  onUpdateCart,
  onPlaceOrder,
  isDesktop,
  onClose,
  isPlacingOrder = false,
}) => {
  const [isInQueue, setIsInQueue] = React.useState(false);
  const [queueMessage, setQueueMessage] = React.useState("");
  const [showConfirmDialog, setShowConfirmDialog] = React.useState(false);
  const BAG_PRICE = 10;

  // Submit the order
  const submitOrder = async () => {
    try {
      setIsInQueue(true);
      setQueueMessage("Processing your order...");

      // Call the parent's onPlaceOrder function and wait for it to complete
      await onPlaceOrder();

    } catch (error) {
      console.error('Error placing order:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert(`Failed to place order: ${errorMessage}`);
    } finally {
      setIsInQueue(false);
      setQueueMessage("");
    }
  };

  // When Place Order button is clicked, show confirmation dialog
  const handlePlaceOrder = async () => {
    // Show confirmation dialog
    setShowConfirmDialog(true);
  };

  // Handle order confirmation
  const handleConfirmOrder = async () => {
    setShowConfirmDialog(false);
    await submitOrder();
  };

  // Handle order cancellation
  const handleCancelOrder = () => {
    setShowConfirmDialog(false);
  };



  const renderQuantityControls = (item: CartItemDetails) => {
    const step = item.unitType === "COUNT" ? 1 : 0.25;
    return (
      <div className="flex items-center border border-slate-300 rounded-md overflow-hidden h-9">
        <button
          onClick={() => onUpdateCart(item.vegetableId, item.quantityKg - step)}
          disabled={item.quantityKg <= 0}
          className="px-3 h-full flex items-center justify-center bg-slate-50 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
        >
          <MinusIcon className="h-4 w-4" />
        </button>
        <input
          type="number"
          value={item.unitType === "COUNT" ? Math.floor(item.quantityKg) : item.quantityKg}
          onChange={(e) =>
            onUpdateCart(item.vegetableId, parseFloat(e.target.value) || 0)
          }
          className="w-16 h-full text-center font-bold text-primary-700 focus:outline-none bg-white border-x border-slate-300"
          min={0}
          max={item.stockKg}
          step={step}
        />
        <button
          onClick={() => onUpdateCart(item.vegetableId, item.quantityKg + step)}
          disabled={item.quantityKg >= item.stockKg}
          className="px-3 h-full flex items-center justify-center bg-slate-50 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div
        className={`flex items-center justify-between p-2 sm:p-3 border-b border-slate-200 ${
          isDesktop ? "" : "bg-slate-50"
        }`}
      >
        <h2 className="text-xl font-bold text-slate-800">Your Order</h2>
        {!isDesktop && (
          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-500 hover:bg-slate-200"
            aria-label="Close cart"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-3">
        {cartItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-500">
            <ShoppingCartIcon className="h-16 w-16 text-slate-300" />
            <p className="mt-4">Your cart is empty.</p>
            <p className="text-sm text-slate-400">Add items to get started.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-2 py-2 px-2 bg-slate-50 rounded-md text-xs font-semibold text-slate-600 uppercase tracking-wide">
              <div className="col-span-1 text-center">S.No</div>
              <div className="col-span-5">Item Name</div>
              <div className="col-span-2 text-center">Qty</div>
              <div className="col-span-2 text-right">Total</div>
              <div className="col-span-2 text-center">Remove</div>
            </div>
            
            {/* Items */}
            {cartItems.map((item, index) => (
              <div
                key={item.vegetableId}
                className="grid grid-cols-12 gap-2 py-2 px-2 border-b border-slate-100 last:border-b-0 items-center hover:bg-slate-50 rounded-md"
              >
                {/* Serial Number */}
                <div className="col-span-1 text-center">
                  <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-semibold text-slate-700 bg-slate-200 rounded-full">
                    {index + 1}
                  </span>
                </div>
                
                {/* Item Name */}
                <div className="col-span-5 flex items-center">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">{item.name}</p>
                    <p className="text-xs text-slate-500">
                      ₹{item.pricePerKg.toFixed(2)}/{item.unitType === "KG" ? "kg" : "piece"}
                    </p>
                  </div>
                </div>
                
                {/* Quantity */}
                <div className="col-span-2 text-center">
                  <span className="text-sm font-medium text-slate-700">
                    {item.unitType === "COUNT" ? Math.floor(item.quantityKg) : item.quantityKg}
                    <span className="text-xs text-slate-500 ml-1">
                      {item.unitType === "KG" ? "kg" : "pcs"}
                    </span>
                  </span>
                </div>
                
                {/* Total */}
                <div className="col-span-2 text-right">
                  <span className="text-sm font-semibold text-slate-800">
                    ₹{item.subtotal.toFixed(2)}
                  </span>
                </div>
                
                {/* Remove Button */}
                <div className="col-span-2 text-center flex justify-center">
                  <button
                    onClick={() => {
                      onUpdateCart(item.vegetableId, 0);
                    }}
                    className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full transition-colors duration-200 flex items-center justify-center"
                    title="Remove item"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 sm:p-3 border-t border-slate-200 bg-white">
        {/* Bags */}
        {onBagCountChange && (
          <div className="mb-2 pb-2 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-800">Shopping Bags</h4>
                <p className="text-xs text-slate-500">₹{BAG_PRICE} per bag</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onBagCountChange(false)}
                  disabled={bagCount <= 0}
                  className="w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white flex items-center justify-center text-sm font-semibold"
                >
                  -
                </button>
                <span className="text-lg font-semibold text-slate-800 min-w-[1.5rem] text-center">{bagCount}</span>
                <button
                  onClick={() => onBagCountChange(true)}
                  className="w-6 h-6 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center text-sm font-semibold"
                >
                  +
                </button>
                <div className="ml-2 text-right">
                  <p className="text-xs text-slate-500">Bag Total</p>
                  <p className="text-sm font-semibold text-slate-800">₹{bagCount * BAG_PRICE}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Total */}
        <div className="flex justify-between text-xl font-bold mb-2">
          <span>Total</span>
          <span>₹{total.toFixed(2)}</span>
        </div>

        {/* Place Order Button */}
        <Button
          size="lg"
          className="w-full"
          disabled={cartItems.length === 0 || isPlacingOrder}
          onClick={handlePlaceOrder}
        >
          <div className="flex items-center justify-center">
            {isPlacingOrder ? (
              <>
                <div className="w-5 h-5 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                <div className="flex flex-col items-center">
                  <span className="text-sm font-medium">
                    {isInQueue ? "In Queue" : "Placing Order..."}
                  </span>
                  {queueMessage && (
                    <span className="text-xs opacity-90 mt-1">
                      {queueMessage}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <CheckCircleIcon className="w-5 h-5 mr-2" />
                <span>Place Order</span>
              </>
            )}
          </div>
        </Button>
        
          {/* Order Confirmation Modal */}
          {showConfirmDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              {/* Backdrop - slight blur + dark overlay */}
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleCancelOrder} />

              <div className="relative bg-white rounded-lg shadow-lg p-6 w-full max-w-md z-10">
                <h3 className="text-lg font-semibold mb-3">Confirm Your Order</h3>
                <p className="text-sm text-slate-500 mb-4">
                  Are you sure you want to place this order? 
                </p>
                
                {/* Order Summary */}
                <div className="bg-slate-50 rounded-lg p-3 mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-slate-600">Total Items:</span>
                    <span className="text-sm font-semibold text-slate-800">{cartItems.length + (bagCount > 0 ? 1 : 0)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-slate-600">Total Amount:</span>
                    <span className="text-lg font-bold text-primary-600">₹{total.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    className="px-4 py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
                    onClick={handleCancelOrder}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 rounded-md bg-primary-600 hover:bg-primary-700 text-white font-medium transition-colors"
                    onClick={handleConfirmOrder}
                  >
                    Confirm Order
                  </button>
                </div>
              </div>
            </div>
          )}
        
        {/* Queue Information */}
        {isInQueue && (
          <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-xs text-yellow-800 text-center">
              💡 <strong>Queue System Active:</strong> Orders are processed one at a time to ensure unique invoice numbers. Please wait...
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const CartView: React.FC<CartViewProps> = ({ isOpen = false, isDesktop = false, onClose = () => {}, ...props }) => {
  if (isDesktop) return <CartContent isDesktop onClose={onClose} {...props} />;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 z-40 transform transition-transform duration-300 ease-in-out ${
        isOpen ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="relative w-full h-full">
        <CartContent onClose={onClose} {...props} />
      </div>
    </div>
  );
};

export default CartView;
