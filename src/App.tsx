/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Reports from "./pages/Reports";
import ReportConfirm from "./pages/ReportConfirm";
import Trends from "./pages/Trends";
import Medications from "./pages/Medications";
import Timeline from "./pages/Timeline";
import Summary from "./pages/Summary";

export default function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/confirm" element={<ReportConfirm />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/medications" element={<Medications />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/summary" element={<Summary />} />
        </Routes>
      </Layout>
    </Router>
  );
}
