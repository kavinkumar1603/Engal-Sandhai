import React, { useState, useMemo, useEffect } from 'react';
import type { Vegetable, Bill, User } from '../../types/types';
import { CalendarDaysIcon, ArrowDownTrayIcon, CubeIcon } from './ui/Icon.tsx';
import Button from './ui/Button.tsx';
import { fetchBillsForDateRange, fetchVegetablesForDate } from '../services/dbService';
import { add, sub, mul, div } from '../utils/mathUtils';
import { fixFloatingPoint } from '../utils/roundUtils';

interface WeeklyInventoryProps {
  vegetables: Vegetable[];
  bills: Bill[];
  user: User;
  refreshTrigger?: number; // Optional prop to trigger data refresh
}

interface WeekStockData {
  vegetable: Vegetable;
  totalStock: number;
  availableStock: number;
  ordersOut: number;
  outPercentage: number;
  totalRevenue: number;
}

const WeeklyInventory: React.FC<WeeklyInventoryProps> = ({ vegetables, bills, user, refreshTrigger }) => {
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    // Get the Monday of current week
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    return monday.toISOString().split('T')[0];
  });

  const [weeklyBills, setWeeklyBills] = useState<Bill[]>([]);
  const [weeklyVegetables, setWeeklyVegetables] = useState<Vegetable[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());

  // Calculate week dates from selected date
  const weekDates = useMemo(() => {
    const startDate = new Date(selectedDate);
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      dates.push(date);
    }
    return dates;
  }, [selectedDate]);

  // Load bills and vegetables for the entire week
  useEffect(() => {
    const loadWeeklyData = async () => {
      setIsLoadingData(true);
      try {
        const startDate = weekDates[0];
        const endDate = weekDates[6];


        // Fetch both bills and vegetables concurrently
        const [bills, weekVegetables] = await Promise.all([
          fetchBillsForDateRange(startDate, endDate),
          fetchVegetablesForDate(startDate) // Get vegetables from start of week for initial stock
        ]);

        setWeeklyBills(bills);
        setWeeklyVegetables(weekVegetables);

      } catch (error) {
        console.error('Error loading weekly data:', error);
        setWeeklyBills([]);
        setWeeklyVegetables([]);
      } finally {
        setIsLoadingData(false);
      }
    };

    loadWeeklyData();
  }, [weekDates, refreshTrigger, vegetables.length]); // Refresh when week changes, refresh trigger, or vegetables change

  // Manual refresh function
  const handleRefresh = async () => {
    setIsLoadingData(true);
    try {
      const startDate = weekDates[0];
      const endDate = weekDates[6];


      // Fetch fresh data from database
      const [bills, weekVegetables] = await Promise.all([
        fetchBillsForDateRange(startDate, endDate),
        fetchVegetablesForDate(startDate)
      ]);

      setWeeklyBills(bills);
      setWeeklyVegetables(weekVegetables);
      setLastRefreshTime(new Date());

    } catch (error) {
      console.error('Error refreshing weekly data:', error);
    } finally {
      setIsLoadingData(false);
    }
  };

  // Calculate weekly stock data with percentages
  const weeklyStockData = useMemo((): WeekStockData[] => {
    const stockMap = new Map<string, WeekStockData>();

    // Helper to normalize vegetable names for grouping
    const normalizeName = (name: string) => name.trim().toLowerCase();

    // 1. Initialize with available vegetables (from Monday/Start of week)
    // We group by NAME because IDs might differ across days if re-entered
    const vegetablesToUse = weeklyVegetables.length > 0 ? weeklyVegetables : vegetables;

    vegetablesToUse.forEach(veg => {
      const key = normalizeName(veg.name);
      if (!stockMap.has(key)) {
        stockMap.set(key, {
          vegetable: veg,
          totalStock: veg.totalStockKg,
          availableStock: veg.stockKg,
          ordersOut: 0,
          outPercentage: 0,
          totalRevenue: 0
        });
      } else {
        // If duplicate name found (unlikely for same day, but possible), sum up
        const existing = stockMap.get(key)!;
        existing.totalStock = add(existing.totalStock, veg.totalStockKg);
        existing.availableStock = add(existing.availableStock, veg.stockKg);
      }
    });

    // 2. Process Bills to get ACCURATE Sales & Revenue
    weeklyBills.forEach(bill => {
      // Skip if bill has no items
      if (!bill.items || bill.items.length === 0) return;

      bill.items?.forEach(item => {
        // Try to find by ID first (if from same day), then by Name
        let stockData: WeekStockData | undefined;

        // Try finding by name (most reliable across days)
        const nameKey = normalizeName(item.name || 'unknown');
        stockData = stockMap.get(nameKey);

        if (stockData) {
          stockData.ordersOut = add(stockData.ordersOut, item.quantityKg);
          stockData.totalRevenue = add(stockData.totalRevenue, item.subtotal);
        } else {
          // Item in bill but not in stock list (maybe added mid-week)
          // Create a placeholder entry
          stockMap.set(nameKey, {
            vegetable: {
              id: item.vegetableId,
              name: item.name || 'Unknown',
              category: 'Unlisted',
              pricePerKg: item.pricePerKg || 0,
              totalStockKg: 0, // Unknown initial stock
              stockKg: 0,
              unitType: 'KG' // Assumption
            },
            totalStock: 0,
            availableStock: 0,
            ordersOut: item.quantityKg,
            outPercentage: 0,
            totalRevenue: item.subtotal
          });
        }
      });
    });

    // 3. Final Calculations
    const result = Array.from(stockMap.values()).map(data => {
      // Fix floating-point precision for orders out
      data.ordersOut = fixFloatingPoint(data.ordersOut, 2);
      data.totalRevenue = fixFloatingPoint(data.totalRevenue, 2);
      
      // Calculate available stock dynamically: Available = Total - Orders Out
      data.availableStock = fixFloatingPoint(sub(data.totalStock, data.ordersOut), 2);
      
      // Ensure available stock doesn't go negative
      if (data.availableStock < 0) {
        data.availableStock = 0;
      }
      
      // Calculate percentage
      // If Total Stock is 0 (e.g. unlisted item), percentage is 100% if sold anything
      if (data.totalStock > 0) {
        data.outPercentage = fixFloatingPoint(mul(div(data.ordersOut, data.totalStock), 100), 1);
      } else {
        data.outPercentage = data.ordersOut > 0 ? 100 : 0;
      }

      return data;
    });

    // Sort by highest out percentage
    return result.sort((a, b) => b.outPercentage - a.outPercentage);
  }, [vegetables, weeklyVegetables, weeklyBills]);

  // Calculate totals
  const totals = useMemo(() => {
    const result = weeklyStockData.reduce((acc, data) => ({
      totalStock: add(acc.totalStock, data.totalStock),
      availableStock: add(acc.availableStock, data.availableStock),
      ordersOut: add(acc.ordersOut, data.ordersOut),
      totalRevenue: add(acc.totalRevenue, data.totalRevenue)
    }), { totalStock: 0, availableStock: 0, ordersOut: 0, totalRevenue: 0 });
    
    // Fix floating-point precision
    return {
      totalStock: fixFloatingPoint(result.totalStock, 2),
      availableStock: fixFloatingPoint(result.availableStock, 2),
      ordersOut: fixFloatingPoint(result.ordersOut, 2),
      totalRevenue: fixFloatingPoint(result.totalRevenue, 2)
    };
  }, [weeklyStockData]);

  const overallOutPercentage = totals.totalStock > 0 ? fixFloatingPoint((totals.ordersOut / totals.totalStock) * 100, 1) : 0;

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      'Vegetable Name',
      'Category',
      'Unit Type',
      'Total Stock',
      'Orders Out',
      'Available Stock',
      'Out Percentage (%)',
      'Revenue (₹)'
    ];

    const rows = weeklyStockData.map(data => [
      data.vegetable.name,
      data.vegetable.category,
      data.vegetable.unitType,
      fixFloatingPoint(data.totalStock, 2),
      fixFloatingPoint(data.ordersOut, 2),
      fixFloatingPoint(data.availableStock, 2),
      fixFloatingPoint(data.outPercentage, 1),
      fixFloatingPoint(data.totalRevenue, 2)
    ]);

    // Add totals row
    rows.push([
      'TOTAL',
      '',
      '',
      fixFloatingPoint(totals.totalStock, 2),
      fixFloatingPoint(totals.ordersOut, 2),
      fixFloatingPoint(totals.availableStock, 2),
      fixFloatingPoint(overallOutPercentage, 1),
      fixFloatingPoint(totals.totalRevenue, 2)
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `weekly-stock-report-${selectedDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };



  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-500 rounded-lg">
                <CalendarDaysIcon className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-800">Weekly Stock Report</h1>
                <p className="text-slate-600">Track inventory movement and stock percentages</p>
                <p className="text-xs text-slate-500 mt-1">
                  Last updated: {lastRefreshTime.toLocaleTimeString()} • Stock reflects all bill edits
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-slate-700">Week Starting:</label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleRefresh}
                  disabled={isLoadingData}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white flex items-center"
                >
                  <CubeIcon className="h-4 w-4 mr-2" />
                  {isLoadingData ? 'Refreshing...' : 'Refresh Data'}
                </Button>
                <Button
                  onClick={exportToCSV}
                  className="bg-green-600 hover:bg-green-700 text-white flex items-center"
                >
                  <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoadingData && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
            <div className="flex items-center justify-center space-x-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <p className="text-slate-600">Loading weekly stock data...</p>
            </div>
          </div>
        )}

        {/* No Data State */}
        {!isLoadingData && weeklyStockData.length === 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
            <div className="text-center">
              <CubeIcon className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No Stock Data Available</h3>
              <p className="text-slate-600">
                No vegetables or orders found for the selected week ({formatDate(weekDates[0])} - {formatDate(weekDates[6])}).
              </p>
            </div>
          </div>
        )}

        {/* Week Summary Cards */}
        {!isLoadingData && weeklyStockData.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Total Stock</p>
                    <p className="text-2xl font-bold text-slate-900">{fixFloatingPoint(totals.totalStock, 2)}</p>
                    <p className="text-xs text-slate-500">kg total inventory</p>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-full">
                    <CubeIcon className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Orders Out</p>
                    <p className="text-2xl font-bold text-red-600">{fixFloatingPoint(totals.ordersOut, 2)}</p>
                    <p className="text-xs text-slate-500">{fixFloatingPoint(overallOutPercentage, 1)}% of total stock</p>
                  </div>
                  <div className="p-3 bg-red-50 rounded-full">
                    <ArrowDownTrayIcon className="h-6 w-6 text-red-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Available Stock</p>
                    <p className="text-2xl font-bold text-green-600">{fixFloatingPoint(totals.availableStock, 2)}</p>
                    <p className="text-xs text-slate-500">kg remaining</p>
                  </div>
                  <div className="p-3 bg-green-50 rounded-full">
                    <CalendarDaysIcon className="h-6 w-6 text-green-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Total Revenue</p>
                    <p className="text-2xl font-bold text-purple-600">₹{fixFloatingPoint(totals.totalRevenue, 2)}</p>
                    <p className="text-xs text-slate-500">this week</p>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-full">
                    <ArrowDownTrayIcon className="h-6 w-6 text-purple-600" />
                  </div>
                </div>
              </div>
            </div>

            {/* Week Calendar */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4">Week Overview</h2>
              <div className="grid grid-cols-7 gap-2">
                {weekDates.map((date, index) => {
                  const isToday = date.toDateString() === new Date().toDateString();
                  return (
                    <div
                      key={index}
                      className={`p-3 text-center rounded-lg border ${isToday
                        ? 'bg-blue-50 border-blue-200 text-blue-800'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                        }`}
                    >
                      <div className="text-xs font-medium">{formatDate(date)}</div>
                      <div className="text-lg font-bold">{date.getDate()}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Detailed Stock Table */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200">
              <div className="p-6 border-b border-slate-200">
                <h2 className="text-lg font-semibold text-slate-800">Detailed Stock Analysis</h2>
                {isLoadingData && <p className="text-sm text-slate-500 mt-1">Loading weekly data...</p>}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-700 uppercase bg-slate-50">
                    <tr>
                      <th className="px-6 py-3">Vegetable</th>
                      <th className="px-6 py-3">Category</th>
                      <th className="px-6 py-3 text-right">Total Stock</th>
                      <th className="px-6 py-3 text-right">Orders Out</th>
                      <th className="px-6 py-3 text-right">Out %</th>
                      <th className="px-6 py-3 text-right">Available</th>
                      <th className="px-6 py-3 text-right">Revenue</th>
                      <th className="px-6 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyStockData.map((data, index) => {
                      const stockLevel = data.outPercentage;
                      const statusColor = stockLevel >= 80 ? 'text-red-600 bg-red-50' :
                        stockLevel >= 50 ? 'text-yellow-600 bg-yellow-50' :
                          'text-green-600 bg-green-50';
                      const statusText = stockLevel >= 80 ? 'Critical' :
                        stockLevel >= 50 ? 'Medium' :
                          'Good';

                      return (
                        <tr key={data.vegetable.id} className="border-b border-slate-200 hover:bg-slate-50">
                          <td className="px-6 py-4 font-medium text-slate-900">
                            {data.vegetable.name}
                          </td>
                          <td className="px-6 py-4 text-slate-600">
                            {data.vegetable.category}
                          </td>
                          <td className="px-6 py-4 text-right font-medium">
                            {fixFloatingPoint(data.totalStock, 2)} {data.vegetable.unitType === 'KG' ? 'kg' : 'pcs'}
                          </td>
                          <td className="px-6 py-4 text-right text-red-600 font-medium">
                            {fixFloatingPoint(data.ordersOut, 2)} {data.vegetable.unitType === 'KG' ? 'kg' : 'pcs'}
                          </td>
                          <td className="px-6 py-4 text-right font-bold">
                            {fixFloatingPoint(data.outPercentage, 1)}%
                          </td>
                          <td className="px-6 py-4 text-right text-green-600 font-medium">
                            {fixFloatingPoint(data.availableStock, 2)} {data.vegetable.unitType === 'KG' ? 'kg' : 'pcs'}
                          </td>
                          <td className="px-6 py-4 text-right font-medium text-purple-600">
                            ₹{fixFloatingPoint(data.totalRevenue, 2)}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColor}`}>
                              {statusText}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default WeeklyInventory;
