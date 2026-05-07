const TOURS = {
  morning1: {
    id: 'morning1',
    name: 'Jutarnja Tura 1',
    departureTime: '07:40',
    direction: 'toOffice',
    stops: [
      'Stup',
      'Nedžarići/Agram',
      'Alipašino/Addiko',
      'RTV',
      'Otoka-bazen',
      'Otoka',
      'Čengić Vila',
      'Malta',
      'Socijalno',
      'Pofalići',
      'Muzej',
      'SCC',
      'Skenderija',
      'Šumarski fakultet',
      'Vraće/Nešković',
      'Office'
    ]
  },
  morning2: {
    id: 'morning2',
    name: 'Jutarnja Tura 2',
    departureTime: '08:40',
    direction: 'toOffice',
    stops: [
      'Dobrinja',
      'Mojmilo',
      'Stup',
      'Nedžarići/Agram',
      'Alipašino/Addiko',
      'RTV',
      'Otoka-bazen',
      'Otoka',
      'Čengić Vila',
      'Malta',
      'Socijalno',
      'Pofalići',
      'Muzej',
      'SCC',
      'Skenderija',
      'Šumarski fakultet',
      'Vraće/Nešković',
      'Office'
    ]
  },
  afternoon1: {
    id: 'afternoon1',
    name: 'Popodnevna Tura 1',
    departureTime: '16:20',
    direction: 'fromOffice',
    stops: [
      'Office',
      'Vraće/Nešković',
      'Šumarski fakultet',
      'Skenderija',
      'SCC',
      'Muzej',
      'Pofalići',
      'Socijalno',
      'Malta',
      'Čengić Vila',
      'Otoka',
      'Otoka-bazen',
      'RTV',
      'Alipašino/Addiko',
      'Nedžarići/Agram',
      'Stup'
    ]
  },
  afternoon2: {
    id: 'afternoon2',
    name: 'Popodnevna Tura 2',
    departureTime: '17:30',
    direction: 'fromOffice',
    stops: [
      'Office',
      'Vraće/Nešković',
      'Šumarski fakultet',
      'Skenderija',
      'SCC',
      'Muzej',
      'Pofalići',
      'Socijalno',
      'Malta',
      'Čengić Vila',
      'Otoka',
      'Otoka-bazen',
      'RTV',
      'Alipašino/Addiko',
      'Nedžarići/Agram',
      'Stup',
      'Mojmilo',
      'Dobrinja'
    ]
  }
};

const TOTAL_SEATS = 19;

module.exports = { TOURS, TOTAL_SEATS };
