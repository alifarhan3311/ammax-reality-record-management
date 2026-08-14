import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, CalendarDays, Eye, FilePlus2, LogOut, Moon, Pencil, Search, ShieldCheck, Sun, Trash2, UserRound, X } from 'lucide-react';

const emptyForm = {
  address: '', agent: '', closeOfDeal: '', salePrice: '', buyer: '',
  acceptanceDate: '', dealNumber: '', email: '', seller: '', reviewer: '',
  yearBuilt: '', type: 'Purchase', checklistType: 'Buyer Side Sale', office: '', subjectRemovalDate: ''
};

const fields = [
  ['address', 'Address', 'textarea', '32 Kirkpatrick St, Kirkland Lake, ON P2N 2H1'],
  ['agent', 'Agent', 'text', 'Syed Naqvi'],
  ['closeOfDeal', 'Close of Deal', 'date'],
  ['salePrice', 'Sale Price', 'number', '133000'],
  ['buyer', 'Buyer', 'text', 'Muhammad Akbar Khan'],
  ['acceptanceDate', 'Acceptance Date', 'date'],
  ['dealNumber', 'Deal Number', 'text', '0'],
  ['email', 'Email', 'email', 'client@example.com'],
  ['seller', 'Seller', 'text', 'Linda Marie Helene Belanger'],
  ['reviewer', 'Reviewer', 'text', 'Unassigned'],
  ['yearBuilt', 'Year Built', 'number', '2000'],
  ['type', 'Type', 'select', ['Purchase', 'Sale', 'Lease']],
  ['checklistType', 'Checklist Type', 'select', ['Buyer Side Sale', 'Seller Side Sale', 'Rental']],
  ['office', 'Office', 'text', 'Brampton'],
  ['subjectRemovalDate', 'Subject Removal Date', 'date']
];

async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  if (text.startsWith('An error occurred') || text.includes('FUNCTION_INVOCATION')) throw new Error('Server temporarily unavailable. Check Vercel Function logs and environment variables.');
  throw new Error(text?.slice(0, 180) || `Server returned HTTP ${response.status}`);
}

function Header({ dark, toggleTheme, user, onLogout }) {
  return <header className="header">
    <div className="nav-shell">
      <a className="brand" href="#" aria-label="AMMAX Realty home">
        <img className="logo-image" src="https://ammax.ca/logo.png" alt="AMMAX" />
        <span>AMMAX REALTY INC<span className="gold">.</span></span>
      </a>
      <div className="header-actions">{user && <div className="user-chip"><span className="user-avatar">{user.role === 'admin' ? <ShieldCheck size={16}/> : <UserRound size={16}/>}</span><span><strong>{user.name}</strong><small>{user.role}</small></span></div>}
        <button className="theme-button" onClick={toggleTheme} aria-label="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        {user && <button className="logout-button" onClick={onLogout}><LogOut size={15}/> Logout</button>}
      </div>
    </div>
  </header>;
}

function TransactionCard({ item, onDelete, showOwner }) {
  const display = [
    ['Address', item.address], ['Buyer', item.buyer], ['Agent', item.agent], ['Close of Deal', item.closeOfDeal],
    ['Sale Price', item.salePrice ? `$${Number(item.salePrice).toLocaleString('en-CA', { minimumFractionDigits: 2 })}` : '—'],
    ['Type', item.type]
  ];
  return <article className="transaction-card">
    <div className="card-details">{display.map(([label, value]) => <div className="detail" key={label}>
      <span>{label}</span><strong>{value || '—'}</strong>
    </div>)}</div>{showOwner && <div className="owner-line"><ShieldCheck size={13}/><span>Created by <strong>{item.createdBy?.name || 'Administrator'}</strong>{item.createdBy?.email && ` · ${item.createdBy.email}`}</span></div>}
    <div className="card-actions">
      <Link className="action-button view-action" to={`/transactions/${item._id || item.id}`} aria-label={`View ${item.address}`} title="View transaction"><Eye size={18} /></Link>
      <Link className="action-button edit-action" to={`/transactions/${item._id || item.id}?edit=1`} aria-label={`Edit ${item.address}`} title="Edit transaction"><Pencil size={17} /></Link>
      <button className="action-button delete-action" type="button" onClick={() => onDelete(item)} aria-label={`Delete ${item.address}`} title="Delete transaction"><Trash2 size={17} /></button>
    </div>
  </article>;
}

const summaryFields = [
  ['Address', 'address'], ['Agent', 'agent'], ['Close of Deal', 'closeOfDeal'], ['Sale Price', 'salePrice'], ['Buyer', 'buyer'],
  ['Acceptance Date', 'acceptanceDate'], ['Deal Number', 'dealNumber'], ['Email', 'email'], ['Seller', 'seller'], ['Reviewer', 'reviewer'],
  ['Year Built', 'yearBuilt'], ['Type', 'type'], ['Checklist Type', 'checklistType'], ['Office', 'office'], ['Subject Removal Date', 'subjectRemovalDate']
];

function TransactionEditForm({ transaction, onUpdated }) {
  const addressParts = transaction.address?.split(',').map(part => part.trim()) || [];
  const streetMatch = (addressParts[0] || '').match(/^(\d+[A-Za-z-]*)\s+(.*)$/);
  const provincePostal = (addressParts[2] || '').match(/^(.+?)\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)$/i);
  const [form, setForm] = useState({
    agent: transaction.agent || '', office: transaction.office || '', mlsNumber: transaction.mlsNumber || '', checklistType: transaction.checklistType || 'Buyer Side Sale',
    streetNumber: transaction.streetNumber || streetMatch?.[1] || '', direction: transaction.direction || '', streetName: transaction.streetName || streetMatch?.[2] || '', unitNumber: transaction.unitNumber || '',
    postalCode: transaction.postalCode || provincePostal?.[2] || '', province: transaction.province || provincePostal?.[1] || '', city: transaction.city || addressParts[1] || '', county: transaction.county || '',
    coBuyerAgent: transaction.coBuyerAgent || '', type: transaction.type || 'Purchase', salePrice: transaction.salePrice || '', yearBuilt: transaction.yearBuilt || '', source: transaction.source || '',
    dealNumber: transaction.dealNumber || '', officeLead: transaction.officeLead || '', fileId: transaction.fileId || '', subjectRemovalDate: transaction.subjectRemovalDate || '',
    acceptanceDate: transaction.acceptanceDate || '', closeOfDeal: transaction.closeOfDeal || '', actualClosingDate: transaction.actualClosingDate || ''
  });
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState('');
  const update = (name, value) => setForm(current => ({ ...current, [name]: value }));
  const save = async event => {
    event.preventDefault(); setSaving(true); setMessage('');
    const street = [form.streetNumber, form.direction, form.streetName].filter(Boolean).join(' ');
    const cityLine = [form.province, form.postalCode].filter(Boolean).join(' ');
    const payload = { ...form, address: [street, form.city, cityLine].filter(Boolean).join(', ') };
    try {
      const response = await fetch(`/api/transactions/${transaction._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Could not update transaction');
      onUpdated(result); setMessage('Transaction saved successfully.');
    } catch (error) { setMessage(error.message); } finally { setSaving(false); }
  };
  const input = (label, name, type = 'text', required = false, readOnly = false) => <label><span>{label}{required && <b> *</b>}</span><input type={type} step={type === 'number' ? '0.01' : undefined} value={form[name]} onChange={e => update(name, e.target.value)} required={required} readOnly={readOnly} /></label>;
  return <form className="transaction-edit-form" onSubmit={save}>
    <div className="section-heading"><span className="eyebrow">Property & Deal</span><h2>Transaction Information</h2></div>
    <div className="transaction-form-grid">
      {input('Agent', 'agent', 'text', true)}
      <label><span>Office <b>*</b></span><select value={form.office} onChange={e => update('office', e.target.value)} required><option value="">Select office</option><option>Brampton</option><option>Toronto</option><option>Mississauga</option><option>Vaughan</option><option>Other</option></select></label>
      {input('MLS#', 'mlsNumber')}
      <label><span>Checklist Type <b>*</b></span><select value={form.checklistType} onChange={e => update('checklistType', e.target.value)} required><option>Buyer Side Sale</option><option>Seller Side Sale</option><option>Rental</option></select></label>
      <div className="address-pair">{input('Street No.', 'streetNumber', 'text', true)}<label><span>Direction</span><select value={form.direction} onChange={e => update('direction', e.target.value)}><option value="">Select</option><option>N</option><option>S</option><option>E</option><option>W</option><option>NE</option><option>NW</option><option>SE</option><option>SW</option></select></label></div>
      {input('Street Name', 'streetName', 'text', true)}
      <div className="address-pair">{input('Unit #', 'unitNumber')}{input('Postal Code', 'postalCode', 'text', true)}</div>
      <label><span>Province <b>*</b></span><select value={form.province} onChange={e => update('province', e.target.value)} required><option value="">Select province</option><option>Ontario</option><option>Alberta</option><option>British Columbia</option><option>Manitoba</option><option>New Brunswick</option><option>Newfoundland and Labrador</option><option>Nova Scotia</option><option>Prince Edward Island</option><option>Quebec</option><option>Saskatchewan</option></select></label>
      {input('City', 'city', 'text', true)}{input('County', 'county')}{input('Co-Buyer Agent', 'coBuyerAgent')}
      <label><span>Type (Representation) <b>*</b></span><select value={form.type} onChange={e => update('type', e.target.value)} required><option>Purchase</option><option>Sale</option><option>Lease</option></select></label>
      {input('Sale Price', 'salePrice', 'number', true)}{input('Year Built', 'yearBuilt')}
      <label><span>Source</span><select value={form.source} onChange={e => update('source', e.target.value)}><option value="">Select</option><option>Referral</option><option>Website</option><option>Repeat Client</option><option>Walk-in</option><option>Other</option></select></label>
      {input('Deal Number', 'dealNumber')}
      <div className="address-pair"><label><span>Office Lead</span><select value={form.officeLead} onChange={e => update('officeLead', e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></label>{input('File ID', 'fileId')}</div>
      {input('Subject Removal Date', 'subjectRemovalDate', 'date')}
      {input('Acceptance Date', 'acceptanceDate', 'date', true)}{input('Closing Date', 'closeOfDeal', 'date', true)}
      {input('Actual Closing Date', 'actualClosingDate', 'date')}
    </div>
    <div className="contact-actions">{message && <p className={message.includes('successfully') ? 'success' : 'error'}>{message}</p>}<button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save Transaction'}</button></div>
  </form>;
}

const contactCategories = ['Seller / Landlord', 'Buyer / Tenant', 'Lawyer Information', 'Agent Representing Other Side', 'Lender', 'Home Warranty', 'Transaction Coordinator', 'Misc. Contact'];
const blankContact = { entity: false, firstName: '', lastName: '', companyName: '', email: '', streetNumber: '', streetName: '', postalCode: '', city: '', province: '', fax: '', phone: '', alternatePhone: '', notes: '', forwardingAddress: '' };
const contactKey = category => category.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function ContactsForm({ transaction, onUpdated }) {
  const [category, setCategory] = useState(contactCategories[0]);
  const [contacts, setContacts] = useState(transaction.contacts || {});
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const key = contactKey(category);
  const sellerNames = transaction.seller?.trim().split(/\s+/) || [];
  const initialSeller = key === 'seller_landlord' ? { firstName: sellerNames.slice(0, -1).join(' '), lastName: sellerNames.at(-1) || '', email: transaction.email || '' } : {};
  const data = { ...blankContact, ...initialSeller, ...(contacts[key] || {}) };
  useEffect(() => {
    if (search.trim().length < 2) { setSearchResults([]); setSearching(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/contacts/search?q=${encodeURIComponent(search.trim())}`, { signal: controller.signal });
        const result = await readApiResponse(response);
        if (!response.ok) throw new Error(result.message || 'Contact search failed');
        setSearchResults(result);
      } catch (error) { if (error.name !== 'AbortError') setMessage(error.message); }
      finally { setSearching(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search]);
  const selectContact = result => {
    setContacts(current => ({ ...current, [key]: { ...blankContact, ...result.contact } }));
    setSearch(''); setSearchResults([]); setMessage(`Contact loaded from ${result.transactionAddress}.`);
  };
  const update = (name, value) => setContacts(current => ({ ...current, [key]: { ...data, [name]: value } }));
  const copyAddress = () => {
    const addressParts = transaction.address?.split(',').map(part => part.trim()) || [];
    const streetMatch = (addressParts[0] || '').match(/^(\d+[A-Za-z-]*)\s+(.*)$/);
    update('streetNumber', streetMatch?.[1] || '');
    setContacts(current => ({ ...current, [key]: { ...data, streetNumber: streetMatch?.[1] || '', streetName: streetMatch?.[2] || addressParts[0] || '', city: addressParts[1] || '', province: addressParts[2] || '' } }));
  };
  const save = async event => {
    event.preventDefault(); setSaving(true); setMessage('');
    const finalContacts = { ...contacts, [key]: data };
    try {
      const response = await fetch(`/api/transactions/${transaction._id}/contacts`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contacts: finalContacts }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not save contact');
      setContacts(result.contacts || finalContacts); onUpdated(result); setMessage('Contact saved successfully.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };
  const labelPrefix = category === 'Seller / Landlord' ? 'Seller' : category === 'Buyer / Tenant' ? 'Buyer' : 'Contact';
  return <div className="contacts-layout">
    <aside className="contact-sidebar">{contactCategories.map(item => <button className={category === item ? 'active' : ''} onClick={() => { setCategory(item); setMessage(''); }} key={item}>{item}</button>)}</aside>
    <form className="contact-form" onSubmit={save}>
      <div className="contact-form-heading"><div><span className="eyebrow">{category}</span><h2>Contact information</h2></div>{contacts[key] && <span className="saved-badge">Saved</span>}</div>
      <div className="contact-search"><span>Search Contacts</span><div className="search"><Search size={17}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name, email, phone or company" />{searching && <small>Searching…</small>}</div>{searchResults.length > 0 && <div className="contact-search-results">{searchResults.map(result => <button type="button" key={result.id} onClick={() => selectContact(result)}><strong>{[result.contact.firstName, result.contact.lastName].filter(Boolean).join(' ') || result.contact.companyName || 'Unnamed contact'}</strong><span>{result.contact.email || result.contact.phone || result.transactionAddress}</span><small>{result.category.replaceAll('_', ' ')} · {result.transactionAddress}</small></button>)}</div>}{search.trim().length >= 2 && !searching && searchResults.length === 0 && <div className="contact-search-empty">No matching saved contact</div>}</div>
      <div className="or-divider"><span>Or Enter New Contact</span></div>
      <label className="check-field"><input type="checkbox" checked={data.entity} onChange={event => update('entity', event.target.checked)} /><span>{labelPrefix} is a trust, company, or other entity</span></label>
      <div className="contact-fields">
        <label><span>{labelPrefix}'s First Name <b>*</b></span><input value={data.firstName} onChange={e => update('firstName', e.target.value)} required={!data.entity} /></label>
        <label><span>{labelPrefix}'s Last Name <b>*</b></span><input value={data.lastName} onChange={e => update('lastName', e.target.value)} required={!data.entity} /></label>
        <label><span>Company Name</span><input value={data.companyName} onChange={e => update('companyName', e.target.value)} /></label>
        <label><span>E-mail</span><input type="email" value={data.email} onChange={e => update('email', e.target.value)} /></label>
      </div>
      <button className="copy-address" type="button" onClick={copyAddress}>Copy property address to {labelPrefix.toLowerCase()}'s address</button>
      <div className="contact-fields">
        <label><span>Street Number</span><input value={data.streetNumber} onChange={e => update('streetNumber', e.target.value)} /></label>
        <label><span>Street Name</span><input value={data.streetName} onChange={e => update('streetName', e.target.value)} /></label>
        <label><span>Postal Code</span><input value={data.postalCode} onChange={e => update('postalCode', e.target.value)} /></label>
        <label><span>City</span><input value={data.city} onChange={e => update('city', e.target.value)} /></label>
        <label><span>Province</span><input value={data.province} onChange={e => update('province', e.target.value)} /></label>
        <label><span>Fax</span><input value={data.fax} onChange={e => update('fax', e.target.value)} /></label>
        <label><span>Phone</span><input value={data.phone} onChange={e => update('phone', e.target.value)} /></label>
        <label><span>Alternate Phone</span><input value={data.alternatePhone} onChange={e => update('alternatePhone', e.target.value)} /></label>
        <label className="contact-wide"><span>Notes</span><textarea value={data.notes} onChange={e => update('notes', e.target.value)} /></label>
        <label className="contact-wide"><span>Forwarding Address</span><textarea value={data.forwardingAddress} onChange={e => update('forwardingAddress', e.target.value)} /></label>
      </div>
      <div className="contact-actions">{message && <p className={message.includes('successfully') ? 'success' : 'error'}>{message}</p>}<button className="primary" disabled={saving}>{saving ? 'Saving…' : `Save ${category}`}</button></div>
    </form>
  </div>;
}

const blankCommission = { salePrice: '', personalDeal: 'no', listingCommissionPercent: '', listingCommissionAmount: '', saleCommissionPercent: '', saleCommissionAmount: '', officeGrossCommission: '', adminBrokerageComp: '', otherDeductions: '', holdTrustMoney: 'no', depositAmount: '', chequeDate: '', logBookDate: '', referralType: '', referralAgent: '', referralBrokerageName: '', referralAmount: '', referralPercent: '', supportingDocument: '', instructions: '' };
const money = value => value === '' || value === null || value === undefined ? '' : Number(value).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });

function CommissionForm({ transaction, onUpdated }) {
  const [form, setForm] = useState({ ...blankCommission, salePrice: transaction.salePrice || '', ...(transaction.commission || {}) });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const update = (name, value) => {
    const next = { ...form, [name]: value };
    const price = Number(name === 'salePrice' ? value : next.salePrice) || 0;
    if (name === 'salePrice' || name === 'listingCommissionPercent') next.listingCommissionAmount = ((price * (Number(next.listingCommissionPercent) || 0)) / 100).toFixed(2);
    if (name === 'salePrice' || name === 'saleCommissionPercent') next.saleCommissionAmount = ((price * (Number(next.saleCommissionPercent) || 0)) / 100).toFixed(2);
    next.officeGrossCommission = ((Number(next.listingCommissionAmount) || 0) + (Number(next.saleCommissionAmount) || 0)).toFixed(2);
    setForm(next);
  };
  const save = async event => {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      const response = await fetch(`/api/transactions/${transaction._id}/commission`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commission: form }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not save commission');
      setForm({ ...blankCommission, ...(result.commission || form) }); onUpdated(result); setMessage('Commission saved successfully.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };
  const field = (label, name, type = 'number', required = false, readOnly = false) => <label><span>{label}{required && <b> *</b>}</span><input type={type} step={type === 'number' ? '0.01' : undefined} value={form[name]} onChange={e => update(name, e.target.value)} required={required} readOnly={readOnly} /></label>;
  return <form className="commission-form" onSubmit={save}>
    <section className="commission-section"><div className="section-heading"><span className="eyebrow">Financial Details</span><h2>Commission Info</h2></div>
      <div className="commission-grid">
        {field('Sale Price', 'salePrice', 'number', true)}
        <fieldset className="radio-field"><legend>Personal Deal</legend><label><input type="radio" name="personalDeal" value="yes" checked={form.personalDeal === 'yes'} onChange={e => update('personalDeal', e.target.value)} /> Yes</label><label><input type="radio" name="personalDeal" value="no" checked={form.personalDeal === 'no'} onChange={e => update('personalDeal', e.target.value)} /> No</label></fieldset>
        <div className="split-field"><label><span>Listing Commission % <b>*</b></span><input type="number" step="0.01" value={form.listingCommissionPercent} onChange={e => update('listingCommissionPercent', e.target.value)} required /></label><label><span>Calculated Amount</span><input value={money(form.listingCommissionAmount)} readOnly /></label></div>
        {field('Office Gross Commission on Sale', 'officeGrossCommission', 'text', false, true)}
        <div className="split-field"><label><span>Sale Commission % <b>*</b></span><input type="number" step="0.01" value={form.saleCommissionPercent} onChange={e => update('saleCommissionPercent', e.target.value)} required /></label><label><span>Calculated Amount</span><input value={money(form.saleCommissionAmount)} readOnly /></label></div>
        {field('Admin Brokerage Comp', 'adminBrokerageComp')}
        {field('Other Deductions', 'otherDeductions')}
      </div>
    </section>
    <section className="commission-section"><div className="section-heading"><h2>Deposits</h2></div>
      <fieldset className="radio-field trust-radio"><legend>Will Your Brokerage Hold Trust Money?</legend><label><input type="radio" name="holdTrustMoney" value="yes" checked={form.holdTrustMoney === 'yes'} onChange={e => update('holdTrustMoney', e.target.value)} /> Yes</label><label><input type="radio" name="holdTrustMoney" value="no" checked={form.holdTrustMoney === 'no'} onChange={e => update('holdTrustMoney', e.target.value)} /> No</label></fieldset>
      <div className="commission-three">{field('Deposit Amount', 'depositAmount')}{field('Date of Cheque', 'chequeDate', 'date')}{field('Date Posted to Log Book', 'logBookDate', 'date')}</div>
    </section>
    <section className="commission-section"><div className="section-heading"><h2>Referral Details</h2></div>
      <div className="commission-three"><label><span>Referral Type</span><select value={form.referralType} onChange={e => update('referralType', e.target.value)}><option value="">Select</option><option>Incoming</option><option>Outgoing</option><option>Internal</option></select></label>{field('Referral Agent', 'referralAgent', 'text')}{field('Referral Brokerage Name', 'referralBrokerageName', 'text')}</div>
      <div className="commission-three referral-row">{field('Referral Amount', 'referralAmount')} {field('Referral Percentage', 'referralPercent')}<label><span>Supporting Document (PDF only)</span><input className="file-input" type="file" accept="application/pdf" onChange={e => update('supportingDocument', e.target.files[0]?.name || '')} />{form.supportingDocument && <small>{form.supportingDocument}</small>}</label></div>
    </section>
    <section className="commission-section"><div className="section-heading"><h2>Commission Instructions</h2></div><label className="instruction-field"><span>Additional Commission Breakdown Information</span><textarea value={form.instructions} onChange={e => update('instructions', e.target.value)} /></label></section>
    <div className="contact-actions">{message && <p className={message.includes('successfully') ? 'success' : 'error'}>{message}</p>}<button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save Commission'}</button></div>
  </form>;
}

const checklistDocuments = [
  ['Agreement of Purchase', 'Incomplete'], ['Confirmation of Co-op', 'Incomplete'], ['Buyer Representation', 'Completed'],
  ['Fintrac ID', 'Required'], ['Copy of Deposit/Receipt', 'Incomplete'], ['Receipt of Funds (Fintrac)', 'Required'],
  ['Waivers', 'Incomplete'], ['Amendment', 'If Applicable'], ['Survey', 'If Applicable'], ['Water Test', 'If Applicable'],
  ['Septic Receipt', 'If Applicable'], ['MLS Printout', 'If Applicable'], ['Signed Trades (Admin Use Only)', 'Required'],
  ['Mutual Release', 'If Applicable'], ['Registrant Disclosure', 'If Applicable']
];
const defaultChecklist = () => checklistDocuments.map(([documentation, status], index) => ({ id: index + 1, documentation, status, comments: '', attachment: '' }));

function ChecklistForm({ transaction, onUpdated }) {
  const [rows, setRows] = useState(transaction.checklist?.length ? transaction.checklist : defaultChecklist());
  const [pendingFiles, setPendingFiles] = useState({});
  const [filter, setFilter] = useState('All Statuses');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const update = (id, name, value) => setRows(current => current.map(row => row.id === id ? { ...row, [name]: value } : row));
  const save = async () => {
    setSaving(true); setMessage('');
    try {
      let rowsToSave = [...rows];
      for (const [itemId, file] of Object.entries(pendingFiles)) {
        if (!file) continue;
        const uploadData = new FormData(); uploadData.append('file', file);
        const uploadResponse = await fetch(`/api/transactions/${transaction._id}/checklist/${itemId}/upload`, { method: 'POST', body: uploadData });
        const uploaded = await uploadResponse.json();
        if (!uploadResponse.ok) throw new Error(`${file.name}: ${uploaded.error || uploaded.message || 'Upload failed'}`);
        rowsToSave = rowsToSave.map(row => String(row.id) === String(itemId) ? { ...row, attachment: uploaded.name, driveFileId: uploaded.id, driveUrl: uploaded.webViewLink, mimeType: uploaded.mimeType } : row);
      }
      const response = await fetch(`/api/transactions/${transaction._id}/checklist`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checklist: rows }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not save checklist');
      if (rowsToSave !== rows) {
        const finalResponse = await fetch(`/api/transactions/${transaction._id}/checklist`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checklist: rowsToSave }) });
        const finalResult = await finalResponse.json(); if (!finalResponse.ok) throw new Error(finalResult.message || 'Could not save Drive links');
        setRows(finalResult.checklist || rowsToSave); onUpdated(finalResult);
      } else { setRows(result.checklist || rows); onUpdated(result); }
      setPendingFiles({}); setMessage('Checklist and Drive files saved successfully.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };
  const visibleRows = filter === 'All Statuses' ? rows : rows.filter(row => row.status === filter);
  return <div className="checklist-form">
    <div className="checklist-heading"><div><span className="eyebrow">Compliance Documents</span><h2>Sales Documentation</h2></div><select value={filter} onChange={e => setFilter(e.target.value)}><option>All Statuses</option><option>Incomplete</option><option>Completed</option><option>Required</option><option>If Applicable</option></select></div>
    <div className="checklist-table-wrap"><table className="checklist-table"><thead><tr><th>#</th><th>Documentation</th><th>Status</th><th>Docs</th><th>Comments</th><th>Attachment</th></tr></thead><tbody>
      {visibleRows.map(row => <tr key={row.id}>
        <td>{row.id}.</td><td><strong>{row.documentation}</strong></td>
        <td><select className={`status-select status-${row.status.toLowerCase().replace(' ', '-')}`} value={row.status} onChange={e => update(row.id, 'status', e.target.value)}><option>Incomplete</option><option>Completed</option><option>Required</option><option>If Applicable</option></select></td>
        <td>{row.driveUrl ? <a className="drive-link" href={row.driveUrl} target="_blank" rel="noreferrer" title="Open in Google Drive">📎</a> : <span className={row.attachment ? 'doc-attached' : 'doc-empty'} title={row.attachment || 'No document'}>{row.attachment ? '📎' : '—'}</span>}</td>
        <td><textarea value={row.comments} onChange={e => update(row.id, 'comments', e.target.value)} placeholder="Add comments" /></td>
        <td><div className="attachment-actions"><label className="attach-button">{row.attachment || pendingFiles[row.id] ? 'Replace' : 'Attach'}<input type="file" onChange={e => { const file = e.target.files[0]; if (file) { setPendingFiles(current => ({ ...current, [row.id]: file })); update(row.id, 'attachment', file.name); } }} /></label>{row.driveUrl && <a className="view-document-button" href={row.driveUrl} target="_blank" rel="noreferrer">View</a>}</div>{(pendingFiles[row.id]?.name || row.attachment) && <span className="attachment-name">{pendingFiles[row.id]?.name || row.attachment}</span>}</td>
      </tr>)}
    </tbody></table></div>
    <div className="contact-actions">{message && <p className={message.includes('successfully') ? 'success' : 'error'}>{message}</p>}<button className="primary" type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Checklist'}</button></div>
  </div>;
}

function TransactionDetail({ user, onLogout }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [transaction, setTransaction] = useState(null);
  const [activeTab, setActiveTab] = useState('Transaction');
  const [loading, setLoading] = useState(true);
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  useEffect(() => { fetch(`/api/transactions/${id}`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setTransaction).catch(() => setTransaction(false)).finally(() => setLoading(false)); }, [id]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  if (loading) return <><Header dark={dark} toggleTheme={() => setDark(!dark)} user={user} onLogout={onLogout} /><main><div className="empty standalone"><h3>Loading transaction…</h3></div></main></>;
  if (!transaction) return <><Header dark={dark} toggleTheme={() => setDark(!dark)} user={user} onLogout={onLogout} /><main><div className="empty standalone"><h3>Transaction not found</h3><button className="text-button" onClick={() => navigate('/')}>← Back to transactions</button></div></main></>;
  const valueFor = key => key === 'salePrice' && transaction[key] ? `$${Number(transaction[key]).toLocaleString('en-CA', { minimumFractionDigits: 2 })}` : transaction[key] || '—';
  return <>
    <Header dark={dark} toggleTheme={() => setDark(!dark)} user={user} onLogout={onLogout} />
    <main className="detail-page">
      <button className="back-link" onClick={() => navigate('/')}><ArrowLeft size={16} /> Back to transactions</button>
      <div className="record-title-row">
        <div><span className="eyebrow">Transaction Record</span><h1>{transaction.address?.split(',')[0]}</h1><p>{transaction.address?.split(',').slice(1).join(',').trim() || 'Real estate transaction'}</p></div>
        <span className="status-pill">{transaction.status || 'Active'}</span>
      </div>
      <section className="record-panel">
        <div className="tabs" role="tablist">
          {['Transaction', 'Contacts', 'Commission', 'Checklist'].map(tab => <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}
        </div>
        <div className="summary-grid">{summaryFields.map(([label, key]) => <div className="detail" key={key}><span>{label}</span><strong className={key === 'email' ? 'email-value' : ''}>{valueFor(key)}</strong></div>)}</div>
        {activeTab === 'Transaction' ? <TransactionEditForm transaction={transaction} onUpdated={setTransaction} /> : activeTab === 'Contacts' ? <ContactsForm transaction={transaction} onUpdated={setTransaction} /> : activeTab === 'Commission' ? <CommissionForm transaction={transaction} onUpdated={setTransaction} /> : <ChecklistForm transaction={transaction} onUpdated={setTransaction} />}
      </section>
    </main>
  </>;
}

function TransactionModal({ onClose, onCreated }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const change = e => setForm({ ...form, [e.target.name]: e.target.value });
  const submit = async e => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const response = await fetch('/api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!response.ok) throw new Error('Unable to save transaction');
      onCreated(await response.json()); onClose();
    } catch (err) { setError(err.message); setSaving(false); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="form-title">
      <div className="modal-head">
        <div><span className="eyebrow">New Record</span><h2 id="form-title">Client details</h2><p>Enter the transaction and client information below.</p></div>
        <button className="close" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          {fields.map(([name, label, type, options]) => <label className={type === 'textarea' ? 'wide' : ''} key={name}>
            <span>{label}{['address','agent','buyer','email'].includes(name) && <b> *</b>}</span>
            {type === 'textarea' ? <textarea name={name} value={form[name]} onChange={change} placeholder={options} required />
              : type === 'select' ? <select name={name} value={form[name]} onChange={change}>{options.map(o => <option key={o}>{o}</option>)}</select>
              : <input name={name} type={type} value={form[name]} onChange={change} placeholder={options || ''} required={['address','agent','buyer','email'].includes(name)} />}
          </label>)}
        </div>
        {error && <p className="error">{error}. Please make sure the server is running.</p>}
        <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Create Transaction'}</button></div>
      </form>
    </section>
  </div>;
}

function TransactionsPage({ user, onLogout }) {
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [deletingId, setDeletingId] = useState('');
  useEffect(() => {
    fetch('/api/transactions')
      .then(async response => {
        if (!response.ok) throw new Error((await response.json()).message || 'Could not load transactions');
        return response.json();
      })
      .then(setTransactions)
      .catch(error => setLoadError(error.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  const filtered = transactions.filter(t => [t.address, t.buyer, t.seller, t.agent].some(v => v?.toLowerCase().includes(query.toLowerCase())));
  const deleteTransaction = async item => {
    const id = item._id || item.id;
    if (!window.confirm(`Delete transaction "${item.address}"?\n\nThis action cannot be undone.`)) return;
    setDeletingId(id);
    try {
      const response = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not delete transaction');
      setTransactions(current => current.filter(transaction => (transaction._id || transaction.id) !== id));
    } catch (error) { window.alert(error.message); }
    finally { setDeletingId(''); }
  };
  return <>
    <Header dark={dark} toggleTheme={() => setDark(!dark)} user={user} onLogout={onLogout} />
    <main>
      <div className="page-heading">
        <div><span className="eyebrow">Records Management</span><h1>Transactions</h1><p>Manage your real estate transaction records in one place.</p></div>
        <button className="primary create" onClick={() => setOpen(true)}><FilePlus2 size={17} /> Create Transaction</button>
      </div>
      <div className="toolbar"><div className="search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search transactions" /></div><span>{filtered.length} {filtered.length === 1 ? 'record' : 'records'}</span></div>
      {loading ? <div className="empty"><div className="empty-icon"><CalendarDays /></div><h3>Loading transactions…</h3></div>
        : loadError ? <div className="empty"><div className="empty-icon"><X /></div><h3>Transactions could not be loaded</h3><p>{loadError}. Please check the MongoDB connection.</p></div>
        : filtered.length ? <div className={`transaction-list ${deletingId ? 'is-deleting' : ''}`}>{filtered.map(t => <TransactionCard key={t._id || t.id} item={t} onDelete={deleteTransaction} showOwner={user.role === 'admin'} />)}</div>
        : <div className="empty"><div className="empty-icon"><Building2 /></div><h3>{query ? 'No matching transaction found' : 'No transaction found'}</h3><p>{query ? 'Try a different search term.' : 'Create your first transaction to see it listed here.'}</p>{!query && <button className="text-button" onClick={() => setOpen(true)}>Create a transaction →</button>}</div>}
    </main>
    {open && <TransactionModal onClose={() => setOpen(false)} onCreated={item => setTransactions([item, ...transactions])} />}
  </>;
}

function AuthPage({ mode, onAuthenticated }) {
  const isSignup = mode === 'signup'; const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async event => {
    event.preventDefault(); setError('');
    if (isSignup && form.password !== form.confirmPassword) return setError('Passwords do not match');
    setSaving(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const result = await readApiResponse(response); if (!response.ok) throw new Error(result.message || 'Authentication failed');
      onAuthenticated(result.user); navigate('/');
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  return <div className="auth-page"><div className="auth-brand"><img src="https://ammax.ca/logo.png" alt="AMMAX"/><span>AMMAX REALTY INC<span className="gold">.</span></span></div><section className="auth-card"><span className="eyebrow">Records Management</span><h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1><p>{isSignup ? 'Sign up to manage your own transaction records.' : 'Sign in to continue to your transactions.'}</p><form onSubmit={submit}>{isSignup && <label><span>Full Name</span><input value={form.name} onChange={e => setForm({...form,name:e.target.value})} required autoComplete="name" /></label>}<label><span>Email Address</span><input type="email" value={form.email} onChange={e => setForm({...form,email:e.target.value})} required autoComplete="email" /></label><label><span>Password</span><input type="password" minLength="8" value={form.password} onChange={e => setForm({...form,password:e.target.value})} required autoComplete={isSignup ? 'new-password' : 'current-password'} /></label>{isSignup && <label><span>Confirm Password</span><input type="password" minLength="8" value={form.confirmPassword} onChange={e => setForm({...form,confirmPassword:e.target.value})} required autoComplete="new-password" /></label>}{error && <p className="error">{error}</p>}<button className="primary auth-submit" disabled={saving}>{saving ? 'Please wait…' : isSignup ? 'Create Account' : 'Sign In'}</button></form><div className="auth-switch">{isSignup ? 'Already have an account?' : 'New to AMMAX Records?'} <Link to={isSignup ? '/login' : '/signup'}>{isSignup ? 'Sign in' : 'Create account'}</Link></div></section></div>;
}

export default function App() {
  const [user, setUser] = useState(null); const [checking, setChecking] = useState(true);
  useEffect(() => { fetch('/api/auth/me').then(response => response.ok ? response.json() : null).then(result => setUser(result?.user || null)).finally(() => setChecking(false)); }, []);
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); setUser(null); };
  if (checking) return <div className="auth-loading"><img src="https://ammax.ca/logo.png" alt="AMMAX"/><p>Loading secure workspace…</p></div>;
  return <Routes>
    <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthPage mode="login" onAuthenticated={setUser} />} />
    <Route path="/signup" element={user ? <Navigate to="/" replace /> : <AuthPage mode="signup" onAuthenticated={setUser} />} />
    <Route path="/" element={user ? <TransactionsPage user={user} onLogout={logout} /> : <Navigate to="/login" replace />} />
    <Route path="/transactions/:id" element={user ? <TransactionDetail user={user} onLogout={logout} /> : <Navigate to="/login" replace />} />
    <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
  </Routes>;
}
