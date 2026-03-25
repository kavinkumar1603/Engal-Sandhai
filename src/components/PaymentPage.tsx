
import React, { useState, useRef, ChangeEvent } from 'react';
import Button from './ui/Button.tsx';
import { ArrowLeftIcon, CloudArrowUpIcon, TrashIcon, RefreshIcon } from './ui/Icon.tsx';
import qrImg from '../assets/QR.png';

interface PaymentPageProps {
  total: number;
  onConfirmOrder: (screenshot: File) => Promise<void>;
  onBack: () => void;
}

// UPI payment link with fixed payee ID; amount substituted at runtime
const UPI_PAYMENT_LINK = `upi://pay?pa=paytm.s1xteyq@pty&pn=Engal%20Santhai&am=${'TOTAL'}&cu=INR`;


const PaymentPage: React.FC<PaymentPageProps> = ({ total, onConfirmOrder, onBack }) => {
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setScreenshot(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleRemoveScreenshot = () => {
    setScreenshot(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if(fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  }

  const handleConfirm = async () => {
    if (screenshot && !isProcessing) {
      setIsProcessing(true);
      try {
        await onConfirmOrder(screenshot);
      } catch (error) {
        console.error("Failed to confirm order:", error);
        alert("There was an error processing your order. Please try again.");
        setIsProcessing(false);
      }
    }
  };
  
  const paymentLink = UPI_PAYMENT_LINK.replace('TOTAL', String(Math.round(total)));

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 sm:p-8 relative">
        <button onClick={onBack} className="absolute top-4 left-4 p-2 text-slate-500 hover:text-slate-800" aria-label="Go back to order">
          <ArrowLeftIcon className="h-6 w-6" />
        </button>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800">Complete Your Payment</h1>
          <p className="text-4xl font-extrabold text-primary-600 mt-2">₹{total.toFixed(2)}</p>
        </div>

        <div className="mt-6 text-center">
            <h2 className="text-sm font-semibold text-slate-600 mb-2">1. Pay using QR Code or UPI App</h2>
            <div className="flex justify-center">
                <img src={qrImg} alt="UPI QR Code" className="w-48 h-48 rounded-lg border-4 border-slate-200" />
            </div>
            <a href={paymentLink}>
                <Button className="w-full mt-4 bg-blue-600 hover:bg-blue-700">
                    Pay with UPI App
                </Button>
            </a>
        </div>

        <div className="mt-8 text-center">
            <h2 className="text-sm font-semibold text-slate-600 mb-2">2. Upload Payment Screenshot</h2>
            {previewUrl ? (
                <div className="relative group">
                    <img src={previewUrl} alt="Payment screenshot preview" className="w-full h-auto max-h-60 object-contain rounded-lg border border-slate-200" />
                    <button onClick={handleRemoveScreenshot} className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                        <TrashIcon className="h-5 w-5"/>
                    </button>
                </div>
            ) : (
                <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-1 flex justify-center rounded-lg border border-dashed border-slate-900/25 px-6 py-10 cursor-pointer hover:border-primary-500"
                >
                    <div className="text-center">
                        <CloudArrowUpIcon className="mx-auto h-12 w-12 text-slate-300" aria-hidden="true" />
                        <div className="mt-4 flex text-sm leading-6 text-slate-600">
                            <p className="pl-1">Click to upload a file</p>
                        </div>
                        <p className="text-xs leading-5 text-slate-600">PNG, JPG, GIF up to 10MB</p>
                    </div>
                    <input ref={fileInputRef} onChange={handleFileChange} id="file-upload" name="file-upload" type="file" className="sr-only" accept="image/*" />
                </div>
            )}
        </div>

    <div className="mt-8">
      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={isProcessing}
          className="flex-1 px-4 py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
        >
          Cancel
        </button>

        <Button onClick={handleConfirm} disabled={!screenshot || isProcessing} className="flex-1" size="lg">
          {isProcessing ? (
            <>
              <RefreshIcon className="h-5 w-5 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            'Confirm'
          )}
        </Button>
      </div>
      <p className="text-xs text-slate-400 text-center mt-2">Order will be placed only after confirmation.</p>
    </div>
      </div>
    </div>
  );
};

export default PaymentPage;