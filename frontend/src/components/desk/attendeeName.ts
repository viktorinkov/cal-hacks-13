const FIRST = [
  'Maya', 'Ethan', 'Priya', 'Lucas', 'Sofia', 'Noah', 'Aisha', 'Diego', 'Hana', 'Marcus', 'Elena', 'Kenji', 'Chloe',
  'Omar', 'Zoe', 'Ravi', 'Isabel', 'Tyler', 'Mei', 'Jonah', 'Amara', 'Leo', 'Nina', 'Caleb', 'Yara', 'Felix',
  'Grace', 'Mateo', 'Lena', 'Sam', 'Arjun', 'Bianca', 'Connor', 'Dalia', 'Emeka', 'Fatima', 'Gabriel', 'Harper',
  'Ines', 'Jamal', 'Kira', 'Liam', 'Malia', 'Nikhil', 'Olivia', 'Pablo', 'Quinn', 'Rosa', 'Sanjay', 'Talia', 'Umar',
  'Vera', 'Wes', 'Ximena', 'Yusuf', 'Zara', 'Aditi', 'Ben', 'Camila', 'Daniel', 'Esther', 'Farah', 'Gus', 'Hiro',
  'Ivy', 'Jae', 'Kofi', 'Lucia', 'Max', 'Nadia', 'Oscar', 'Paloma', 'Rahul', 'Sienna', 'Theo', 'Uma', 'Victor',
  'Wen', 'Yuki', 'Zain', 'Alana', 'Bruno', 'Cyrus', 'Divya', 'Eli', 'Freya', 'Gianna', 'Hugo', 'Ishaan', 'Jade',
  'Kai', 'Leila', 'Mika', 'Nora', 'Owen', 'Pia', 'Rhea', 'Soren', 'Tara', 'Ulises', 'Vik', 'Willa', 'Xavier',
  'Yasmin', 'Zeke', 'Ana', 'Brandon', 'Celine', 'Dev', 'Emma', 'Finn', 'Gia', 'Hamza', 'Iris', 'Jules', 'Kenzo',
  'Lila', 'Milo', 'Noor', 'Orion', 'Petra', 'Ren', 'Sara', 'Tomas', 'Wanda',
] as const

const LAST = [
  'Chen', 'Patel', 'Garcia', 'Kim', 'Nguyen', 'Okafor', 'Silva', 'Novak', 'Haddad', 'Rossi', 'Tanaka', 'Moreno',
  'Fischer', 'Adeyemi', 'Larsen', 'Kaur', 'Dubois', 'Ivanova', 'Mensah', 'Park', 'Singh', 'Lopez', 'Wang', 'Ali',
  'Johnson', 'Hernandez', 'Sato', 'Kowalski', 'Rahman', 'Costa', 'Murphy', 'Yilmaz', 'Petrov', 'Mwangi', 'Lee',
  'Martinez', 'Cohen', 'Ito', 'Gupta', 'Nakamura', 'Smith', 'Reyes', 'Zhang', 'Ahmed', 'Brown', 'Torres', 'Liu',
  'Kapoor', 'Schmidt', 'Ortiz', 'Huang', 'Diaz', 'Wilson', 'Choi', 'Ramirez', 'Yang', 'Davis', 'Iyer', 'Lindqvist',
  'Romero', 'Abebe', 'Khan', 'Nowak', 'Gomez', 'Taylor', 'Wu', 'Sanchez', 'Kuznetsov', 'Anderson', 'Bose', 'Flores',
  'Jung', 'Mendes', 'Clarke', 'Osei', 'Walker', 'Shah', 'Volkov', 'Rivera', 'Hoang', 'Moore', 'Tran', 'Castillo',
  'Yamamoto', 'Thompson', 'Bauer', 'Ruiz', 'Lin', 'Jackson', 'Pereira', 'Alvarez', 'Saito', 'Kumar', 'Jensen',
  'Ng', 'White', 'Morales', 'Ozturk', 'Harris', 'Vargas', 'Das', 'Muller', 'Santos', 'Hall', 'Mehta', 'Ross',
  'Barros', 'Chowdhury', 'Young', 'Dang', 'Popescu', 'Afolabi', 'Wright', 'Bianchi', 'Holm', 'Rao', 'Green', 'Pham',
] as const

function mix(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * A stable name for a person on the event graph. The same node keeps the same name for every viewer,
 * including someone who cannot open the staff attendee list. A real display name replaces it when one exists.
 */
export function attendeeName(id: string): string {
  const hash = mix(id)
  return `${FIRST[hash % FIRST.length]} ${LAST[Math.floor(hash / FIRST.length) % LAST.length]}`
}
