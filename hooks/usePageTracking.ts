// hooks/usePageTracking.ts
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { logEvent } from 'firebase/analytics';
import { analytics } from '../src/firebase';

/**
 * Custom hook to automatically track page views with Google Analytics
 * Triggers on every route change
 */
export const usePageTracking = () => {
    const location = useLocation();

    useEffect(() => {
        // Get the current page path
        const pagePath = location.pathname;

        // Map routes to user-friendly page titles
        const pageTitleMap: Record<string, string> = {
            '/': 'Login',
            '/dashboard': 'Dashboard',
            '/my-orders': 'My Orders',
            '/admin-choice': 'Admin Choice',
            '/admin/dashboard': 'Admin Dashboard',
            '/admin/inventory': 'Inventory',
            '/admin/orders': 'Orders',
            '/admin/reports': 'Reports',
            '/admin/weekly-stock': 'Weekly Stock',
            '/admin/create-bill': 'Create Bill',
            '/admin/settings': 'Settings',
        };

        // Get page title, handle dynamic routes like /admin/user-orders/:userId
        let pageTitle = pageTitleMap[pagePath] || 'Unknown Page';

        if (pagePath.startsWith('/admin/user-orders/')) {
            pageTitle = 'User Orders';
        }

        // Log page view event to Firebase Analytics
        logEvent(analytics, 'page_view', {
            page_path: pagePath,
            page_title: pageTitle,
        });

    }, [location]);
};
