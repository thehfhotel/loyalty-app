import React from 'react';
import { X, Download, Share } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Coupon } from '../../services/couponService';
import toast from 'react-hot-toast';

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  coupon: Coupon;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({
  isOpen,
  onClose,
  coupon
}) => {
  if (!isOpen) return null;

  const handleDownload = () => {
    if (!coupon.qrCode) return;
    
    // Create a download link for the QR code
    const link = document.createElement('a');
    link.href = coupon.qrCode;
    link.download = `${coupon.code}-qr-code.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success('QR code downloaded');
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: coupon.title,
          text: `Check out this coupon: ${coupon.title}`,
          url: window.location.href
        });
      } catch (error) {
        // User cancelled sharing
      }
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(coupon.code);
      toast.success('Coupon code copied to clipboard');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle>Coupon QR Code</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="p-2"
          >
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>
        
        <CardContent className="text-center space-y-4">
          {/* QR Code */}
          {coupon.qrCode && (
            <div className="flex justify-center">
              <div className="bg-white p-4 rounded-xl shadow-sm border">
                <img 
                  src={coupon.qrCode} 
                  alt="Coupon QR Code"
                  className="w-48 h-48"
                />
              </div>
            </div>
          )}
          
          {/* Coupon Info */}
          <div className="space-y-2">
            <h3 className="font-semibold text-lg text-gray-900">
              {coupon.title}
            </h3>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-sm text-gray-600 mb-1">Coupon Code</div>
              <code className="font-mono text-lg font-bold text-primary-600">
                {coupon.code}
              </code>
            </div>
            <p className="text-sm text-gray-600">
              Show this QR code at checkout to redeem your coupon
            </p>
          </div>
          
          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={handleDownload}
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={handleShare}
            >
              <Share className="w-4 h-4 mr-2" />
              Share
            </Button>
          </div>
          
          <Button
            variant="primary"
            fullWidth
            onClick={onClose}
          >
            Done
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};